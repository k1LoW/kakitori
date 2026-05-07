import { char, type Char } from "../char.js";
import { defaultCharDataLoader, defaultConfigLoader } from "../dataLoader.js";
import type { CharDataLoaderFn, ConfigLoaderFn } from "../charOptions.js";
import {
  DEFAULT_NORMALIZE_TARGET,
  type NormalizeTarget,
} from "../recognition/normalize.js";
import type { BlockLoaders } from "./types.js";

/**
 * Module-level cache of headless `Char` instances keyed by character. Free
 * cells / annotations re-use these for judging without re-creating an
 * offscreen hanzi-writer per call.
 *
 * Invariant: a cached Char is always headless (never mounted). Don't
 * `mount()` an instance returned from here — `mount()` and `judge()` are
 * exclusive on the same Char by design.
 */
export interface JudgeCharEntry {
  char: Char;
  /** Number of data strokes in hanzi-writer-data-jp for this character. */
  dataStrokeCount: number;
  /**
   * Number of logical strokes the user is expected to write (one finger
   * motion per logical stroke). Equals `strokeGroups.length` when groups
   * are configured by `configLoader`, otherwise equals `dataStrokeCount`.
   */
  logicalStrokeCount: number;
  /**
   * Bbox of the character's median paths in hanzi-writer internal coords
   * (Y-up, [0, HANZI_COORD_SIZE]). Used as the normalize target so the
   * user's drawn segment is mapped onto the same area the matcher expects
   * — including the natural padding hanzi-writer leaves around each
   * character.
   */
  normalizeTarget: NormalizeTarget;
  /**
   * Mutex tail for {@link runWithJudgeLock}. `Char.judge()` mutates
   * hanzi-writer's shared quiz state (`_currentStrokeIndex`,
   * `_userStroke`, `capture`) and awaits during stroke-ending judgment,
   * so concurrent callers against the same cached instance would
   * interleave and corrupt each other's per-stroke results. Hidden from
   * external callers; use `runWithJudgeLock` instead of touching it.
   */
  judgeLock: Promise<void>;
}

const cache = new Map<string, JudgeCharEntry>();
// In-flight creations keyed the same way as `cache`. Concurrent
// `getJudgeChar` calls for the same key share this promise so they don't
// race to construct two `Char` instances and then leak the loser.
const inFlight = new Map<string, Promise<JudgeCharEntry>>();

export interface GetJudgeCharOptions extends BlockLoaders {
  /**
   * Stroke-matcher leniency forwarded to `char.create`. Different leniencies
   * for the same character get separate cached instances so callers don't
   * collide on each other's threshold tuning.
   */
  leniency?: number;
}

/**
 * Look up (or lazily create) the judge-only Char for a single character.
 * Awaits both `ready()` (so strokeGroups / strokeEndings are loaded) AND
 * the character data fetch (so stroke counts are known up-front — Char's
 * `getLogicalStrokeCount()` returns 0 on a headless instance until judge()
 * has been called once, which is too late for free cells deciding when to
 * trigger a match attempt).
 */
export function getJudgeChar(
  c: string,
  opts: GetJudgeCharOptions = {},
): Promise<JudgeCharEntry> {
  const key = cacheKey(c, opts);
  const cached = cache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const promise = (async () => {
    const inst = char.create(c, {
      ...(opts.charDataLoader ? { charDataLoader: opts.charDataLoader } : {}),
      // Pass through configLoader so kakitori-data's strokeEndings / strokeGroups
      // are auto-applied; that's what wires tome/hane/harai detection through
      // free cells without explicit per-character configuration.
      ...(opts.configLoader !== undefined ? { configLoader: opts.configLoader } : {}),
      ...(opts.leniency !== undefined ? { leniency: opts.leniency } : {}),
    });
    try {
      await inst.ready();
      const meta = await loadCharMeta(c, opts.charDataLoader);
      const groups = inst.getStrokeGroups();
      const logicalStrokeCount = groups ? groups.length : meta.dataStrokeCount;
      const entry: JudgeCharEntry = {
        char: inst,
        dataStrokeCount: meta.dataStrokeCount,
        logicalStrokeCount,
        normalizeTarget: meta.normalizeTarget,
        judgeLock: Promise.resolve(),
      };
      cache.set(key, entry);
      return entry;
    } catch (err) {
      // ready() / loadCharMeta() raced past create(), so the inst we just
      // built would otherwise leak (configReady, judger state, possibly a
      // pending DOM-side ready) every time a flaky loader rejects.
      inst.destroy();
      throw err;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

/**
 * Cache key includes loader identity (function reference) so that two Blocks
 * configured with different `charDataLoader` / `configLoader` don't share the
 * same `Char` instance — which would otherwise pin behavior (stroke counts,
 * strokeEndings) to whichever loader populated the cache first. Default
 * loaders normalize to a stable string so the common path stays a single
 * shared entry per `(character, leniency)`.
 */
function cacheKey(c: string, opts: GetJudgeCharOptions): string {
  const charLoaderKey = loaderId("char", opts.charDataLoader, defaultCharDataLoader);
  const configLoaderKey =
    opts.configLoader === null
      ? "config=null"
      : loaderId("config", opts.configLoader, defaultConfigLoader);
  const leniencyKey = opts.leniency === undefined ? "len=default" : `len=${opts.leniency}`;
  return `${c}|${leniencyKey}|${charLoaderKey}|${configLoaderKey}`;
}

const loaderIds = new WeakMap<object, number>();
let loaderSeq = 0;
function loaderId(
  prefix: string,
  loader: CharDataLoaderFn | ConfigLoaderFn | undefined,
  defaultLoader: CharDataLoaderFn | ConfigLoaderFn,
): string {
  const fn = loader ?? defaultLoader;
  if (fn === defaultLoader) {
    return `${prefix}=default`;
  }
  let id = loaderIds.get(fn as unknown as object);
  if (id === undefined) {
    id = ++loaderSeq;
    loaderIds.set(fn as unknown as object, id);
  }
  return `${prefix}=${id}`;
}

interface CharMeta {
  dataStrokeCount: number;
  normalizeTarget: NormalizeTarget;
}

function loadCharMeta(
  c: string,
  charDataLoader: CharDataLoaderFn = defaultCharDataLoader,
): Promise<CharMeta> {
  return new Promise((resolve, reject) => {
    charDataLoader(
      c,
      (data) => {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let any = false;
        for (const stroke of data.medians) {
          for (const point of stroke) {
            const [x, y] = point;
            if (typeof x !== "number" || typeof y !== "number") {
              continue;
            }
            if (x < minX) {
              minX = x;
            }
            if (x > maxX) {
              maxX = x;
            }
            if (y < minY) {
              minY = y;
            }
            if (y > maxY) {
              maxY = y;
            }
            any = true;
          }
        }
        // Fall back to the full canvas when a character has no medians (a
        // theoretical edge case for character data without sampled paths).
        const normalizeTarget: NormalizeTarget = any
          ? {
              centerX: (minX + maxX) / 2,
              centerY: (minY + maxY) / 2,
              longerSide: Math.max(maxX - minX, maxY - minY),
            }
          : DEFAULT_NORMALIZE_TARGET;
        resolve({ dataStrokeCount: data.strokes.length, normalizeTarget });
      },
      (err) =>
        reject(
          err instanceof Error
            ? err
            : new Error(`getJudgeChar(): failed to load character data for "${c}"`),
        ),
    );
  });
}

/**
 * Serialize an async section against a cached `Char` so concurrent free
 * cells judging the same character don't interleave on the shared
 * hanzi-writer quiz state. Holds the entry's `judgeLock` for the duration
 * of `fn`; `fn` is responsible for issuing every `judge()` call against
 * `entry.char` that needs to see consistent state.
 */
export async function runWithJudgeLock<T>(
  entry: JudgeCharEntry,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = entry.judgeLock;
  let release!: () => void;
  entry.judgeLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    return await fn();
  } finally {
    release();
  }
}

/**
 * Test-only helper: drop every cached Char. Production code should not call
 * this — the cache is meant to live for the process.
 */
export function _clearJudgeCharCacheForTests(): void {
  for (const entry of cache.values()) {
    entry.char.destroy();
  }
  cache.clear();
  inFlight.clear();
}
