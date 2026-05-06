import { char, type Char } from "../char.js";
import { defaultCharDataLoader } from "../dataLoader.js";
import type { CharDataLoaderFn } from "../charOptions.js";
import type { NormalizeTarget } from "../recognition/normalize.js";
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
}

const cache = new Map<string, JudgeCharEntry>();

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
export async function getJudgeChar(
  c: string,
  opts: GetJudgeCharOptions = {},
): Promise<JudgeCharEntry> {
  const key = cacheKey(c, opts.leniency);
  let entry = cache.get(key);
  if (!entry) {
    const inst = char.create(c, {
      ...(opts.charDataLoader ? { charDataLoader: opts.charDataLoader } : {}),
      // Pass through configLoader so kakitori-data's strokeEndings / strokeGroups
      // are auto-applied; that's what wires tome/hane/harai detection through
      // free cells without explicit per-character configuration.
      ...(opts.configLoader !== undefined ? { configLoader: opts.configLoader } : {}),
      ...(opts.leniency !== undefined ? { leniency: opts.leniency } : {}),
    });
    await inst.ready();
    const meta = await loadCharMeta(c, opts.charDataLoader);
    const groups = inst.getStrokeGroups();
    const logicalStrokeCount = groups ? groups.length : meta.dataStrokeCount;
    entry = {
      char: inst,
      dataStrokeCount: meta.dataStrokeCount,
      logicalStrokeCount,
      normalizeTarget: meta.normalizeTarget,
    };
    cache.set(key, entry);
  }
  return entry;
}

function cacheKey(c: string, leniency: number | undefined): string {
  return leniency === undefined ? c : `${c}|len=${leniency}`;
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
        const HANZI_COORD_SIZE_FALLBACK = 900;
        const normalizeTarget: NormalizeTarget = any
          ? {
              centerX: (minX + maxX) / 2,
              centerY: (minY + maxY) / 2,
              longerSide: Math.max(maxX - minX, maxY - minY),
            }
          : {
              centerX: HANZI_COORD_SIZE_FALLBACK / 2,
              centerY: HANZI_COORD_SIZE_FALLBACK / 2,
              longerSide: HANZI_COORD_SIZE_FALLBACK,
            };
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
 * Test-only helper: drop every cached Char. Production code should not call
 * this — the cache is meant to live for the process.
 */
export function _clearJudgeCharCacheForTests(): void {
  for (const entry of cache.values()) {
    entry.char.destroy();
  }
  cache.clear();
}
