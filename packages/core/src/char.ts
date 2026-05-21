import HanziWriter, { type HanziWriterOptions } from "hanzi-writer";
import type {
  CharCreateOptions,
  CharResult,
  CharCheckStrokeOptions,
  CharStrokeResult,
  CharLogger,
  GridOptions,
  MountOptions,
  RenderOptions,
} from "./charOptions.js";
import type {
  CharStrokeData,
  StrokeEnding,
  StrokeEndingResult,
  TimedPoint,
} from "./types.js";
import { defaultCharDataLoader, defaultConfigLoader } from "./dataLoader.js";
import {
  DEFAULT_SIZE,
  DEFAULT_PADDING,
  HANZI_PRESCALED_SIZE,
  HANZI_Y_MAX,
  HANZI_Y_BASELINE_OFFSET,
} from "./constants.js";
import { computeEndingCheck } from "./endingCheck.js";
import { attachEndingCheckPatch } from "./patchEndingCheck.js";
import {
  isFirstInGroup as isFirstInGroupPure,
  isLastInGroup as isLastInGroupPure,
  getLogicalStrokeNum as getLogicalStrokeNumPure,
  getRemainingSkipsInGroup as getRemainingSkipsInGroupPure,
  logicalStrokesRemaining as logicalStrokesRemainingPure,
} from "./strokeGroups.js";
import type {
  HanziCharacterData,
  HanziQuiz,
  Pt,
  QuizStrokeMeta,
} from "./hanziWriterInternals.js";

const DEFAULT_GRID_COLOR = "#ccc";
const DEFAULT_GRID_DASH = "10,10";
const DEFAULT_GRID_WIDTH = 2;

// hanzi-writer's stroke matcher thresholds, hard-coded inside its source.
// We mirror them here to derive a similarity score from
// `Stroke.getAverageDistance` without re-running the matcher.
const HW_AVERAGE_DISTANCE_THRESHOLD = 350;

/** Convert hanzi-writer's per-stroke average distance into a similarity in [0, 1]. */
function computeSimilarity(
  stroke: { getAverageDistance(points: Pt[]): number } | undefined,
  points: Pt[],
  leniency: number | undefined,
): number {
  const avgDist = stroke ? stroke.getAverageDistance(points) : Infinity;
  const threshold = HW_AVERAGE_DISTANCE_THRESHOLD * (leniency ?? 1);
  return threshold > 0 ? Math.max(0, Math.min(1, 1 - avgDist / threshold)) : 0;
}

function drawCrossGrid(
  svg: SVGSVGElement,
  size: number,
  gridOpts: GridOptions | true,
): void {
  const opts = gridOpts === true ? {} : gridOpts;
  const color = opts.color ?? DEFAULT_GRID_COLOR;
  const dashArray = opts.dashArray ?? DEFAULT_GRID_DASH;
  const width = opts.width ?? DEFAULT_GRID_WIDTH;
  const ns = "http://www.w3.org/2000/svg";
  const mid = size / 2;

  const vLine = document.createElementNS(ns, "line");
  vLine.setAttribute("x1", String(mid));
  vLine.setAttribute("y1", "0");
  vLine.setAttribute("x2", String(mid));
  vLine.setAttribute("y2", String(size));
  vLine.setAttribute("stroke", color);
  vLine.setAttribute("stroke-width", String(width));
  vLine.setAttribute("stroke-dasharray", dashArray);
  vLine.setAttribute("pointer-events", "none");

  const hLine = document.createElementNS(ns, "line");
  hLine.setAttribute("x1", "0");
  hLine.setAttribute("y1", String(mid));
  hLine.setAttribute("x2", String(size));
  hLine.setAttribute("y2", String(mid));
  hLine.setAttribute("stroke", color);
  hLine.setAttribute("stroke-width", String(width));
  hLine.setAttribute("stroke-dasharray", dashArray);
  hLine.setAttribute("pointer-events", "none");

  svg.appendChild(vLine);
  svg.appendChild(hLine);
}

function validateSizeAndPadding(
  size: number,
  padding: number,
  context: string,
): void {
  if (!Number.isFinite(size)) {
    throw new Error(`${context}: size must be finite, got ${size}`);
  }
  if (size <= 0) {
    throw new Error(`${context}: size must be positive, got ${size}`);
  }
  if (!Number.isFinite(padding)) {
    throw new Error(`${context}: padding must be finite, got ${padding}`);
  }
  if (padding < 0) {
    throw new Error(`${context}: padding must be non-negative, got ${padding}`);
  }
  if (padding >= size / 2) {
    throw new Error(`${context}: padding (${padding}) must be less than size/2 (${size / 2})`);
  }
}

export function computeMedianPathLength(
  points: Array<{ x: number; y: number }>,
): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

/**
 * Project drawn points from a source coordinate-space square into
 * hanzi-writer's internal coord space:
 *
 *   x: `[sourceBox.x, sourceBox.x + size]` → `[0, HANZI_PRESCALED_SIZE]`
 *   y: `[sourceBox.y, sourceBox.y + size]` → `[HANZI_Y_MAX, HANZI_Y_MIN]`
 *
 * Source is assumed to be Y-down (browser/SVG); internal is Y-up (math)
 * with the character's top at `HANZI_Y_MAX` and descender bottom at
 * `HANZI_Y_MIN` (= -124). The Y axis flips during projection, and the
 * resulting Y range is asymmetric, NOT `[0, HANZI_PRESCALED_SIZE]`.
 */
export function projectToInternal(
  points: ReadonlyArray<TimedPoint>,
  sourceBox: { x: number; y: number; size: number },
): TimedPoint[] {
  if (sourceBox.size <= 0 || !Number.isFinite(sourceBox.size)) {
    throw new Error(
      `char.checkStroke(): sourceBox.size must be a positive finite number, got ${sourceBox.size}`,
    );
  }
  const scale = HANZI_PRESCALED_SIZE / sourceBox.size;
  return points.map((p) => ({
    x: (p.x - sourceBox.x) * scale,
    y: HANZI_Y_MAX - (p.y - sourceBox.y) * scale,
    t: p.t,
  }));
}

/**
 * SVG polyline attributes for one retained user stroke, suitable for
 * setting on a `<polyline>` element inside a `viewBox="0 0 size size"`
 * overlay layered above hanzi-writer's SVG.
 *
 * Returned by {@link computeRetainedStrokeAttrs}; consumers (the mount
 * path) build the element and apply these attributes verbatim.
 */
export interface RetainedStrokeAttrs {
  /** Whitespace-separated `"x,y"` pairs in the overlay's viewBox space. */
  points: string;
  stroke: string;
  /** Stroke width in viewBox (logical) units. */
  strokeWidth: number;
}

/**
 * Pure-math companion to the mount path's retain-strokes overlay. Given
 * a user stroke (in hanzi-writer internal coords) plus the layer's
 * geometry, returns the polyline attrs to draw under
 * `MountOptions.retainStrokes`. Extracted so the inverse projection
 * (HANZI_Y_MAX-flip + cssScale handling + drawingWidth→display
 * conversion) can be unit-tested without driving hanzi-writer's quiz.
 *
 * `proj` is the same projection that `captureProjection` records on
 * pointerdown; its `originX/Y` are in client coords and `scale` is in
 * (HANZI_PRESCALED_SIZE / innerSize_cssScaled). `layerRect` is the
 * layer element's `getBoundingClientRect()` at the time of rendering.
 *
 * Returns null when the stroke is too short to draw (`points.length < 2`).
 */
export function computeRetainedStrokeAttrs(
  points: ReadonlyArray<TimedPoint>,
  proj: { originX: number; originY: number; scale: number },
  layerRect: { left: number; top: number; width: number },
  size: number,
  padding: number,
  options: {
    retainedStrokeColor?: string;
    retainedStrokeWidth?: number;
    drawingColor?: string;
    drawingWidth?: number;
  },
): RetainedStrokeAttrs | null {
  if (points.length < 2) {
    return null;
  }
  // The overlay SVG's viewBox is `0..size`, so convert CSS-px values
  // back to logical units before writing polyline points.
  const cssScale = (layerRect.width || size) / size;
  const padOffsetX = (proj.originX - layerRect.left) / cssScale;
  const padOffsetY = (proj.originY - layerRect.top) / cssScale;
  const invScale = 1 / (proj.scale * cssScale);
  const ptsStr = points
    .map((p) => {
      const dx = p.x * invScale + padOffsetX;
      const dy = (HANZI_Y_MAX - p.y) * invScale + padOffsetY;
      return `${dx},${dy}`;
    })
    .join(" ");
  // hanzi-writer interprets `drawingWidth` in its internal coord system
  // and applies the `<g>` scale, so on-screen pen thickness is
  // `drawingWidth * innerSize / HANZI_PRESCALED_SIZE`. Match it so the
  // retained ink visually equals the live drawing.
  const innerSize = size - 2 * padding;
  const hwToDisplayScale = innerSize / HANZI_PRESCALED_SIZE;
  const strokeWidth =
    options.retainedStrokeWidth ??
    (options.drawingWidth ?? 4) * hwToDisplayScale;
  return {
    points: ptsStr,
    stroke: options.retainedStrokeColor ?? options.drawingColor ?? "#555",
    strokeWidth,
  };
}

/**
 * A Char instance: a 1-character abstraction. Headless by default in the
 * sense that there is no visible on-screen mount, though check() still
 * requires a DOM environment because it lazily mounts an offscreen
 * (hidden) container so hanzi-writer's matcher can run. Call
 * {@link Char.mount} to attach the character to a `target` element for
 * interactive practice and rendering.
 */
export interface Char {
  /** Wait for the async config (strokeGroups, strokeEndings) to finish loading. */
  ready(): Promise<void>;

  // ───── headless check API ─────
  /**
   * Check a single drawn stroke against the corresponding character stroke.
   * `strokeNum` is the logical stroke index (respects `strokeGroups` when
   * configured). Resolves with the per-stroke result.
   *
   * `points` are sampled positions along the drawn trajectory with timestamps
   * (`{ x, y, t }`). `x` and `y` must be in hanzi-writer's internal coord
   * space (`x ∈ [0, HANZI_PRESCALED_SIZE]`, `y ∈ [HANZI_Y_MIN, HANZI_Y_MAX]`,
   * Y-up) unless `opts.sourceBox` is provided.
   * Pass the SAME `sourceBox` for every stroke of one character so the
   * spatial relationship between strokes is preserved. The final element
   * is treated as the moment of pointerup (its `t` becomes the release time);
   * the gap from the previous sample is what tome detection treats as the
   * pause before release.
   *
   * Tome/hane/harai check runs whenever stroke endings are configured for
   * the logical stroke; it relies on `t` values, so include them.
   *
   * Records the result on the instance so {@link Char.result} returns the
   * cumulative check of every stroke checked so far.
   *
   * Throws when called on a mounted instance — check and mount are
   * intentionally exclusive (use a separate Char for each role).
   */
  checkStroke(
    strokeNum: number,
    points: TimedPoint[],
    opts?: CharCheckStrokeOptions,
  ): Promise<CharStrokeResult>;
  /**
   * Run correction on the buffered captures saved by a `correction:
   * "deferred"` mount. Triggers the same finalize-and-dispatch flow
   * as `correction: "per-char"` would run automatically (per-stroke
   * `onCorrectStroke` / `onMistake` + a single `onComplete`, optional
   * `showCharacter` reveal).
   *
   * No-op (logs a warning) when there are no buffered captures —
   * either because the user hasn't drawn the full character yet, or
   * because correction already ran on the buffer.
   */
  check(): Char;
  /**
   * Snapshot of this character's writing progress. Works in both
   * directions:
   * - **headless**: built from {@link Char.checkStroke} calls so far. `mistakes`
   *   / `strokeEndingMistakes` stay undefined since hanzi-writer's quiz
   *   path isn't involved.
   * - **mounted quiz**: built from `start()`'s in-flight per-stroke
   *   callbacks (`onCorrectStroke` / `onMistake` /
   *   `onStrokeEndingMistake`). `mistakes` / `strokeEndingMistakes`
   *   reflect the cumulative counts that hanzi-writer reports.
   *
   * `matched` is true when every observed stroke matched (vacuous true
   * before the first stroke). `complete` flips true once every logical
   * stroke has been observed.
   */
  result(): CharResult;

  // ───── configuration (works headless) ─────
  /** Return the stroke endings loaded from config, or null if not loaded. */
  getStrokeEndings(): readonly StrokeEnding[] | null;
  /** Override stroke endings. Returns the same Char for chaining. */
  setStrokeEndings(strokeEndings: StrokeEnding[]): Char;
  /** Return the stroke groups loaded from config, or null if not loaded. */
  getStrokeGroups(): readonly number[][] | null;
  /** Override stroke groups. Returns the same Char for chaining. */
  setStrokeGroups(strokeGroups: number[][]): Char;
  /**
   * Total logical stroke count. Returns `strokeGroups.length` when groups
   * are configured. Otherwise it counts paths from the mounted SVG when
   * mounted, falls back to the offscreen checker's data-stroke count when
   * headless checking has been started, and returns 0 before either of
   * those (i.e. before mount() and before the first checkStroke() call).
   */
  getLogicalStrokeCount(): number;
  /** Change the displayed character. Resets stroke endings and check result. */
  setCharacter(c: string): Promise<Char>;

  // ───── mount lifecycle ─────
  /**
   * Mount the character to a DOM element for interactive practice
   * (start / animate / etc.). Returns the same Char instance so callers
   * can chain `char.create(...).mount(...).start()`. Throws when check()
   * has already been called on this instance.
   */
  mount(target: string | HTMLElement, mountOpts?: MountOptions): Char;
  /** Unmount from the DOM. The Char remains usable for headless config edits. Returns the same Char for chaining. */
  unmount(): Char;
  /** True between mount() and unmount(). */
  isMounted(): boolean;

  // ───── DOM-bound (require mount) ─────
  /** Start writing practice with stroke order and stroke ending check. Returns the same Char for chaining. */
  start(): Char;
  /**
   * Play stroke-order animation. Always uses the animCJK-style overlay so
   * each stroke's duration is proportional to its median length; defaults to
   * one-stroke-per-group when strokeGroups is not configured. Returns the
   * same Char for chaining.
   */
  animate(): Char;
  /**
   * Return to a clean rest state on the mounted surface: cancel any
   * in-flight animate() overlay, cancel any active quiz (drops pointer
   * listeners and per-run counters), and clear any custom stroke colors
   * applied via {@link setStrokeColor} back to their original values. The
   * current character and configured strokeEndings / strokeGroups stay in
   * place. Returns the same Char for chaining.
   */
  reset(): Char;
  /**
   * Cell-level undo: equivalent to {@link reset} but, if a write quiz was
   * armed via {@link start}, re-arms it so the user can immediately keep
   * writing from stroke 1. Animate-only / show-mode mounts behave like
   * reset(). Returns the same Char for chaining.
   */
  undo(): Char;
  /** Hide the character strokes. Returns the same Char for chaining. */
  hideCharacter(): Char;
  /** Show the character strokes. Returns the same Char for chaining. */
  showCharacter(): Char;
  /** Show the character outline (light gray background). Returns the same Char for chaining. */
  showOutline(): Char;
  /** Hide the character outline. Returns the same Char for chaining. */
  hideOutline(): Char;
  /** Set the color of a logical stroke. Returns the same Char for chaining. */
  setStrokeColor(logicalStrokeNum: number, color?: string): Char;
  /** Reset a single logical stroke's color to its original value. Returns the same Char for chaining. */
  resetStrokeColor(logicalStrokeNum: number): Char;
  /** Reset all stroke colors to their original values. Returns the same Char for chaining. */
  resetStrokeColors(): Char;
  /**
   * Get the logical stroke index at a given point (client coordinates).
   * Uses document.elementFromPoint for accurate hit detection that respects
   * clip-paths and actual rendered output. Returns null if no stroke found.
   */
  getStrokeIndexAtPoint(clientX: number, clientY: number): number | null;

  // ───── teardown ─────
  /**
   * Clean up event listeners, remove the rendered SVG (if mounted), tear
   * down any offscreen judging instance, and mark the Char as destroyed.
   * After destroy, calling any other public method throws. Idempotent.
   */
  destroy(): void;
}

interface MountState {
  targetEl: HTMLElement;
  layerEl: HTMLElement;
  hwSvg: SVGSVGElement | null;
  gridSvg: SVGSVGElement | null;
  activeOverlay: SVGSVGElement | null;
  /**
   * SVG `<g>` (inside a transform-less overlay SVG layered above hwSvg)
   * that accumulates one `<polyline>` per accepted user stroke when
   * `MountOptions.retainStrokes` is true. Created lazily on the first
   * stroke that needs to be retained; cleared on reset / start / undo.
   */
  retainedGroup: SVGGElement | null;
  /**
   * Per-char correction state: each accepted pointer cycle (pointerdown
   * → pointerup) appends one entry. Once its length equals the logical
   * stroke count, kakitori runs check on the buffered captures and
   * fires `onComplete`. Always-null when `correction` is `"per-stroke"`
   * (the hanzi-writer-driven default).
   */
  perCharCaptures: TimedPoint[][] | null;
  /**
   * Pointer handlers attached only in `correction: "per-char"`. Kept as
   * `MountState` fields so {@link cancelActiveQuiz} / {@link unmount}
   * can detach them on teardown.
   */
  perCharOnPointerDown: ((e: PointerEvent) => void) | null;
  perCharOnPointerMove: ((e: PointerEvent) => void) | null;
  perCharOnPointerUp: ((e: PointerEvent) => void) | null;
  perCharOnPointerCancel: ((e: PointerEvent) => void) | null;
  /**
   * Live `<polyline>` for the stroke the user is currently dragging out
   * in per-char mode. Created on pointerdown, points re-derived from
   * `m.timedPoints` on each pointermove, finalized (null'd) on
   * pointerup. The element itself stays in the retained-strokes
   * overlay until `clearRetainedStrokes` or `finalizePerChar` decides
   * what to do with it.
   */
  perCharLivePolyline: SVGPolylineElement | null;
  /**
   * Monotonically-incrementing token for per-char finalize attempts.
   * Bumped when onPointerUp launches `finalizePerChar`, also bumped by
   * `cancelActiveQuiz` / `stopPerCharCycle` to invalidate any in-flight
   * check. `finalizePerChar` captures the value at entry and bails
   * out mid-loop if the token changes, so writes to `m.perStroke` /
   * `m.totalMistakes` and the trailing `onComplete` can't pollute a
   * fresh attempt or a torn-down mount.
   */
  perCharSeq: number;
  /**
   * `correction: "deferred"` mode only: buffered per-stroke captures
   * + the logical stroke count we expect to correct against, stashed
   * when the user finishes drawing all N strokes and waiting for an
   * external `Char.check()` call to trigger correction. Null in any
   * other mode, or after `check()` consumed the buffer.
   *
   * `strokeCount` is captured at stash time (not at `check()` time)
   * so a late `setCharacter()` / `setStrokeGroups()` can't change the
   * number we replay against. It can differ from `captures.length`
   * only in an edge case where N strokes were captured before
   * character data resolved — in that case using the resolved count
   * here, not the length of the buffer, keeps the verdict consistent
   * with what per-char would have produced automatically.
   */
  deferredCaptures: {
    captures: TimedPoint[][];
    strokeCount: number;
  } | null;
  pendingEndingCheck: StrokeEndingResult | null;
  quizActive: boolean;
  /**
   * One-shot teardown for the trailing-click guard armed at quiz /
   * per-char finalize. Browsers dispatch a synthetic `click` after the
   * `pointerup` that ends a drawing gesture; without this guard the
   * trailing click would reach `boundOnClick` AFTER `quizActive` has
   * flipped false and consumers wiring click-to-inspect (e.g.
   * `setStrokeColor`) would recolor a just-finalized stroke. Null
   * unless a guard is currently armed.
   */
  trailingClickGuard: (() => void) | null;
  /**
   * True after start() has armed a write quiz on this mount. Stays true
   * across quiz completion so undo() can re-arm the same quiz; cleared
   * by reset() (intentional opt-out) and on unmount/destroy.
   */
  quizArmed: boolean;
  /**
   * Number of retries already consumed by NG attempts on this mount
   * (per-char / deferred modes). The next NG verdict re-arms when
   * `retries < maxRetries` and commits-as-failed when
   * `retries >= maxRetries`. Sequencing:
   *
   * - Before the first attempt: `retries === 0`.
   * - Inside the retry branch (NG taken as a retry, not a commit),
   *   the counter is bumped to `retries + 1` AFTER the verdict and
   *   BEFORE `onCharRejected` fires, so the callback's `attempts`
   *   field reports the 1-indexed count of the attempt that just
   *   landed NG.
   * - Inside the OK / exhausted-commit path, the counter is left
   *   alone; `onComplete`'s `attempts` is computed as
   *   `retries + 1` so it likewise reports the 1-indexed count of
   *   the attempt that just settled (OK or final NG).
   *
   * Cleared on `start()` / `reset()` / `undo()`. Independent of
   * `m.perCharSeq`, which is a finalize token that flips on every
   * cycle (retry or OK).
   */
  retries: number;
  strokeEndingMistakes: number;
  /**
   * Per-logical-stroke results captured from the quiz callbacks while a
   * write quiz is active. Lets `Char.result()` return a snapshot of the
   * mounted-quiz progress without exposing hanzi-writer internals.
   * Cleared on `start()`, `undo()`, `reset()`, and `unmount()`.
   */
  perStroke: CharStrokeResult[];
  /**
   * Cumulative miss count surfaced by hanzi-writer per-stroke. Mirrors
   * the value `onMistake` deliveries report, summed across all strokes.
   */
  totalMistakes: number;
  /**
   * When `strokeEndingAsMiss` is on, an ending-check failure fires
   * `onStrokeEndingMistake` (matched: true + ending info) AND
   * hanzi-writer's underlying `onMistake` (matched: false). The ending
   * path records the stroke first; this slot tells the upcoming
   * `onMistake` handler "skip the perStroke overwrite for this logical
   * stroke" so the ending data isn't clobbered. Cleared after one
   * onMistake event.
   */
  skipNextOnMistakeStroke: number | null;
  // pointer timing
  isPointerDown: boolean;
  lastMoveTime: number;
  releaseTime: number;
  // Cached projection from client coords → hanzi-writer internal coords,
  // captured on pointerdown so pointermove avoids per-event getBoundingClientRect.
  pointerProjection: { originX: number; originY: number; scale: number } | null;
  timedPoints: Array<{ x: number; y: number; t: number }>;
  boundOnPointerDown: ((e: PointerEvent) => void) | null;
  boundOnPointerMove: ((e: PointerEvent) => void) | null;
  boundOnPointerUp: ((e: PointerEvent) => void) | null;
  boundOnClick: ((e: MouseEvent) => void) | null;
  options: MountOptions;
  hw: HanziWriter;
  size: number;
  padding: number;
}

interface CheckerState {
  container: HTMLDivElement;
  hw: HanziWriter;
  // hanzi-writer's Character instance (`Stroke[]`)
  character: { strokes: Array<{ getAverageDistance(points: Pt[]): number }> };
  // accumulated per-stroke results, indexed by logical stroke num
  perStroke: CharStrokeResult[];
  // patched-handler capture slot for the current checkStroke() call
  capture: { matched: boolean; isBackwards: boolean } | null;
}

function createImpl(character: string, options: CharCreateOptions = {}): Char {
  // ===== always-present state =====
  let destroyed = false;
  let currentCharacter = character;
  let strokeEndings: StrokeEnding[] | null = null;
  let strokeGroups: number[][] | null = options.strokeGroups ?? null;
  let characterData: HanziCharacterData | null = null;
  const log: CharLogger | null = options.logger ?? null;
  const charDataLoader = options.charDataLoader ?? defaultCharDataLoader;
  const leniency = options.leniency;
  const strokeEndingStrictness = options.strokeEndingStrictness ?? 0.7;
  if (
    !Number.isFinite(strokeEndingStrictness) ||
    strokeEndingStrictness < 0 ||
    strokeEndingStrictness > 1
  ) {
    throw new Error(
      `char: strokeEndingStrictness must be in [0, 1], got ${options.strokeEndingStrictness}`,
    );
  }

  // mount-bound and checker-bound state are populated lazily.
  let mounted: MountState | null = null;
  let checker: CheckerState | null = null;
  // Shared promise for the in-flight checker initialisation. Set on the
  // first checkStroke() call, cleared on failure so retries get a fresh chance.
  // Successful init also sets `checker`; later checkStroke() calls short-circuit
  // on `checker` before they ever consult `checkerInit`.
  let checkerInit: Promise<CheckerState> | null = null;
  // Flips to true synchronously the moment check() is called for the
  // first time. mount() checks this so judging-vs-mounting exclusivity
  // holds even before check()'s first await has set `checkerInit`.
  let checkStarted = false;

  // Monotonic counter bumped on every start() / animate() / reset() call.
  // configReady-deferred work captures the seq at scheduling time and bails
  // when a later call has superseded it.
  let requestSeq = 0;

  // ===== helpers =====
  function assertNotDestroyed(): void {
    if (destroyed) {
      throw new Error("char: instance has been destroyed and cannot be used.");
    }
  }
  function assertMounted(): MountState {
    assertNotDestroyed();
    if (!mounted) {
      throw new Error("char: not mounted. Call mount(target, opts) before this operation.");
    }
    return mounted;
  }

  function isFirstInGroup(dataStrokeNum: number): boolean {
    return isFirstInGroupPure(strokeGroups, dataStrokeNum);
  }
  function isLastInGroup(dataStrokeNum: number): boolean {
    return isLastInGroupPure(strokeGroups, dataStrokeNum);
  }
  function getLogicalStrokeNum(dataStrokeNum: number): number {
    return getLogicalStrokeNumPure(strokeGroups, dataStrokeNum);
  }
  function getRemainingSkipsInGroup(dataStrokeNum: number): number {
    return getRemainingSkipsInGroupPure(strokeGroups, dataStrokeNum);
  }
  function logicalStrokesRemaining(
    dataStrokeNum: number,
    hwStrokesRemaining: number,
    isCorrect: boolean,
  ): number {
    return logicalStrokesRemainingPure(strokeGroups, dataStrokeNum, hwStrokesRemaining, isCorrect);
  }

  /** Map a logical stroke index to the first data stroke in its group. */
  function logicalToFirstDataStroke(logicalStrokeNum: number): number {
    if (!strokeGroups) {
      return logicalStrokeNum;
    }
    return strokeGroups[logicalStrokeNum]?.[0] ?? logicalStrokeNum;
  }

  // ===== timing tracking (mount only) =====
  function captureProjection(m: MountState): void {
    // The layer element is square (mount enforces width==height==size). The
    // visible character is rendered inside the layer with `padding` margin,
    // so the inner [padding, size - padding] box is what hanzi-writer maps
    // to internal coords (a HANZI_PRESCALED_SIZE-wide canvas with Y range
    // [HANZI_Y_MIN, HANZI_Y_MAX]). Mirror that mapping here so a pointer
    // landing on the character's left edge becomes internal x=0, not
    // x=padding-scaled, and the top of the inner box becomes y=HANZI_Y_MAX
    // (Y-up). The CSS scale factor (rect.width / m.size) applies to
    // padding too, so we scale it before computing the inner width and
    // origin.
    //
    // mount()'s validateSizeAndPadding guarantees padding < size/2, so the
    // inner width is always positive.
    const rect = m.layerEl.getBoundingClientRect();
    const displayedSize = rect.width || m.size;
    const cssScale = displayedSize / m.size;
    const effectivePadding = m.padding * cssScale;
    const innerSize = displayedSize - 2 * effectivePadding;
    m.pointerProjection = {
      originX: rect.left + effectivePadding,
      originY: rect.top + effectivePadding,
      scale: HANZI_PRESCALED_SIZE / innerSize,
    };
  }

  function projectFromCache(
    m: MountState,
    clientX: number,
    clientY: number,
  ): Pt {
    const proj = m.pointerProjection;
    if (!proj) {
      return { x: 0, y: 0 };
    }
    return {
      x: (clientX - proj.originX) * proj.scale,
      y: HANZI_Y_MAX - (clientY - proj.originY) * proj.scale,
    };
  }

  function startTimingTracking(m: MountState): void {
    stopTimingTracking(m);
    m.boundOnPointerDown = (e: PointerEvent) => {
      m.isPointerDown = true;
      m.timedPoints = [];
      const now = performance.now();
      m.lastMoveTime = now;
      m.releaseTime = 0;
      // Snapshot the layer's rect once per stroke so pointermove only does
      // arithmetic. The layer cannot move mid-stroke without an external
      // resize / scroll, in which case the next pointerdown re-snapshots.
      captureProjection(m);
      const p = projectFromCache(m, e.clientX, e.clientY);
      m.timedPoints.push({ x: p.x, y: p.y, t: now });
      log?.(`pointerdown  x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}`);
    };
    m.boundOnPointerMove = (e: PointerEvent) => {
      if (!m.isPointerDown) {
        return;
      }
      const now = performance.now();
      const dt = (now - m.lastMoveTime).toFixed(0);
      m.lastMoveTime = now;
      const p = projectFromCache(m, e.clientX, e.clientY);
      m.timedPoints.push({ x: p.x, y: p.y, t: now });
      log?.(`pointermove  x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}  dt=${dt}ms`);
    };
    m.boundOnPointerUp = (e: PointerEvent) => {
      if (!m.isPointerDown) {
        return;
      }
      m.isPointerDown = false;
      m.releaseTime = performance.now();
      // Append a synthetic release sample at the same position as the last
      // pointermove. The pause between the user's last move and this
      // release sample is what tome detection uses, so encoding it as the
      // final point's `t` keeps timing within the points array itself.
      const last = m.timedPoints[m.timedPoints.length - 1];
      const releasePoint = last
        ? { x: last.x, y: last.y, t: m.releaseTime }
        : { ...projectFromCache(m, e.clientX, e.clientY), t: m.releaseTime };
      m.timedPoints.push(releasePoint);
      const pause = (m.releaseTime - m.lastMoveTime).toFixed(0);
      log?.(`pointerup    x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}  pause=${pause}ms`);
    };
    // Listen on the Char-owned layerEl (not targetEl) so pointer events on
    // unrelated sibling DOM the host placed inside targetEl never feed
    // into our timing tracker.
    //
    // Capture phase (`useCapture: true`) so layerEl's handler fires before
    // hanzi-writer's listener inside the SVG. That matters most for
    // pointerup: hanzi-writer runs the matcher and its onCorrectStroke /
    // onMistake / ending-check patch synchronously from its own
    // pointerup, so the release sample MUST be appended first or those
    // callbacks would observe `m.timedPoints` without it and tome
    // detection would be skewed. The other two handlers are kept in
    // capture for symmetry — they do not depend on order, but reading
    // them all the same way avoids surprises if hanzi-writer ever does
    // synchronous work in pointerdown / pointermove too.
    m.layerEl.addEventListener("pointerdown", m.boundOnPointerDown, true);
    m.layerEl.addEventListener("pointermove", m.boundOnPointerMove, true);
    m.layerEl.addEventListener("pointerup", m.boundOnPointerUp, true);
  }
  function stopTimingTracking(m: MountState): void {
    if (m.boundOnPointerDown) {
      m.layerEl.removeEventListener("pointerdown", m.boundOnPointerDown, true);
      m.boundOnPointerDown = null;
    }
    if (m.boundOnPointerMove) {
      m.layerEl.removeEventListener("pointermove", m.boundOnPointerMove, true);
      m.boundOnPointerMove = null;
    }
    if (m.boundOnPointerUp) {
      m.layerEl.removeEventListener("pointerup", m.boundOnPointerUp, true);
      m.boundOnPointerUp = null;
    }
  }
  function getCapturedPoints(m: MountState): TimedPoint[] {
    return m.timedPoints.map((p) => ({ x: p.x, y: p.y, t: p.t }));
  }

  /**
   * Lazily set up a transform-less overlay SVG inside layerEl. Retained
   * polylines are painted directly in layer-relative display coords so
   * the ink lands exactly where the user's pointer was; we don't share
   * hanzi-writer's `<g>` transform here because hanzi-writer applies a
   * baseline-offset translation (for the asymmetric Y range) that we
   * don't need when working in display coords.
   */
  function ensureRetainedSvg(m: MountState): SVGGElement | null {
    if (m.retainedGroup) {
      return m.retainedGroup;
    }
    const ns = "http://www.w3.org/2000/svg";
    const overlay = document.createElementNS(ns, "svg") as SVGSVGElement;
    overlay.classList.add("kakitori-retained");
    overlay.setAttribute("width", String(m.size));
    overlay.setAttribute("height", String(m.size));
    overlay.setAttribute("viewBox", `0 0 ${m.size} ${m.size}`);
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.position = "absolute";
    overlay.style.top = "0";
    overlay.style.left = "0";
    // Sit above hwSvg (z-index 1) but below the animate overlay (2) so a
    // mid-stroke `animate()` call still wins visually if it happens.
    overlay.style.zIndex = "1";
    overlay.style.pointerEvents = "none";
    const group = document.createElementNS(ns, "g") as SVGGElement;
    overlay.appendChild(group);
    m.layerEl.appendChild(overlay);
    m.retainedGroup = group;
    return group;
  }

  /**
   * Append one polyline representing a single accepted user stroke into
   * the retained overlay. Converts captured points back from
   * hanzi-writer internal coords (Y-up, x ∈ [0, HANZI_PRESCALED_SIZE],
   * y ∈ [HANZI_Y_MIN, HANZI_Y_MAX]) to layer-relative display pixels so
   * the ink lands exactly where the user drew it. No-op when
   * `retainStrokes` is false or the captured points are insufficient.
   */
  function appendRetainedStroke(m: MountState, points: TimedPoint[]): void {
    if (!m.options.retainStrokes) {
      return;
    }
    paintUserPolyline(m, points);
  }

  /**
   * Paint one finalized polyline into the retained-strokes overlay
   * (no `retainStrokes` gating). {@link appendRetainedStroke} wraps
   * this for per-stroke mode; per-char's live-ink path uses
   * {@link createLivePolyline} + {@link updateLivePolylinePoints}
   * directly so the stroke grows under the pointer instead of
   * snapping in on release.
   */
  function paintUserPolyline(m: MountState, points: TimedPoint[]): void {
    const proj = m.pointerProjection;
    if (!proj) {
      return;
    }
    const layerRect = m.layerEl.getBoundingClientRect();
    const attrs = computeRetainedStrokeAttrs(
      points,
      proj,
      layerRect,
      m.size,
      m.padding,
      m.options,
    );
    if (!attrs) {
      return;
    }
    const group = ensureRetainedSvg(m);
    if (!group) {
      return;
    }
    const ns = "http://www.w3.org/2000/svg";
    const polyline = document.createElementNS(ns, "polyline");
    polyline.setAttribute("points", attrs.points);
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", attrs.stroke);
    polyline.setAttribute("stroke-width", String(attrs.strokeWidth));
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    group.appendChild(polyline);
  }

  /** Wipe every retained polyline. Called on reset() / start() / undo(). */
  function clearRetainedStrokes(m: MountState): void {
    if (!m.retainedGroup) {
      return;
    }
    while (m.retainedGroup.firstChild) {
      m.retainedGroup.removeChild(m.retainedGroup.firstChild);
    }
  }

  function getMountStroke(m: MountState, dataStrokeNum: number) {
    const characterImpl = (
      m.hw as unknown as {
        _character?: { strokes?: Array<{ getAverageDistance(points: Pt[]): number }> };
      }
    )._character;
    return characterImpl?.strokes?.[dataStrokeNum];
  }

  // ===== ending check adapter (mount only) =====
  function runEndingCheck(
    m: MountState,
    _quiz: HanziQuiz,
    dataStrokeNum: number,
    _meta: QuizStrokeMeta,
  ): StrokeEndingResult | null {
    return computeEndingCheck({
      dataStrokeNum,
      points: getCapturedPoints(m),
      strokeEndings,
      strokeGroups,
      characterData,
      drawableSize: HANZI_PRESCALED_SIZE,
      strictness: strokeEndingStrictness,
      log,
    });
  }

  function patchQuizForEnding(m: MountState): void {
    const quiz = (m.hw as unknown as { _quiz?: HanziQuiz })._quiz;
    if (!quiz) {
      return;
    }
    attachEndingCheckPatch(quiz, {
      runCheck: (q, n, meta) => runEndingCheck(m, q, n, meta),
      onMistake: (endingCheck, { quiz: q, dataStrokeNum, willAdvance, meta }) => {
        m.strokeEndingMistakes++;
        const hwData = q._getStrokeData({ isCorrect: willAdvance, meta });
        const logicalStrokeNum = getLogicalStrokeNum(dataStrokeNum);
        const points = getCapturedPoints(m);
        const charData: CharStrokeData = {
          character: currentCharacter,
          strokeNum: logicalStrokeNum,
          // hanzi-writer's matcher accepted the stroke (success path),
          // even though the ending check rejected it.
          matched: true,
          similarity: computeSimilarity(
            getMountStroke(m, dataStrokeNum),
            points,
            leniency,
          ),
          points,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: logicalStrokesRemaining(
            dataStrokeNum,
            hwData.strokesRemaining,
            willAdvance,
          ),
          strokeEnding: endingCheck,
        };
        // Record the matcher's view (matched=true with ending check)
        // before hanzi-writer's own onMistake handler runs and would
        // otherwise overwrite this slot with matched=false. Tag the
        // stroke so that next onMistake skips the overwrite. Only
        // applies when strokeEndingAsMiss is on — otherwise hanzi-writer
        // doesn't fire onMistake for an ending-only failure, so no
        // skipping is needed.
        m.perStroke[logicalStrokeNum] = {
          matched: true,
          similarity: charData.similarity,
          strokeEnding: endingCheck,
          points: charData.points,
          mistakesOnStroke: hwData.mistakesOnStroke,
          isBackwards: hwData.isBackwards,
        };
        m.totalMistakes = hwData.totalMistakes;
        if (m.options.strokeEndingAsMiss) {
          m.skipNextOnMistakeStroke = logicalStrokeNum;
        }
        m.options.onStrokeEndingMistake?.(charData);
      },
      onResolved: (j) => {
        m.pendingEndingCheck = j;
      },
      strokeEndingAsMiss: !!m.options.strokeEndingAsMiss,
      log,
    });
  }

  function startQuiz(m: MountState): void {
    m.quizActive = true;
    m.strokeEndingMistakes = 0;
    m.totalMistakes = 0;
    m.retries = 0;
    m.perStroke = [];
    m.skipNextOnMistakeStroke = null;
    m.pendingEndingCheck = null;

    // Pre-load character data for direction auto-computation
    m.hw.getCharacterData().then((c) => {
      if (destroyed) {
        return;
      }
      characterData = c;
    });

    startTimingTracking(m);

    if (
      m.options.correction === "per-char" ||
      m.options.correction === "deferred"
    ) {
      // Per-char / deferred correction: skip hanzi-writer's quiz
      // entirely; capture every pointer cycle the user draws and
      // live-render the polylines. Per-char then auto-runs correction
      // at N captures; deferred stashes the captures and waits for an
      // external `Char.check()` call.
      startPerCharCycle(m);
      return;
    }

    const quizPromise = m.hw.quiz({
      leniency,
      showHintAfterMisses: m.options.showHintAfterMisses,
      highlightOnComplete: m.options.highlightOnComplete,

      onCorrectStroke: (hwData) => {
        const dataStrokeNum = hwData.strokeNum;
        const logicalStrokeNum = getLogicalStrokeNum(dataStrokeNum);
        const isLast = isLastInGroup(dataStrokeNum);
        const skipsNeeded = getRemainingSkipsInGroup(dataStrokeNum);

        log?.(`stroke correct: data=${dataStrokeNum} logical=${logicalStrokeNum} isLast=${isLast} skips=${skipsNeeded}`);

        if (skipsNeeded > 0) {
          log?.(`auto-skipping ${skipsNeeded} stroke(s) in group`);
          for (let i = 0; i < skipsNeeded; i++) {
            m.hw.skipQuizStroke();
          }
        }

        const points = getCapturedPoints(m);
        // Persist the user's drawn ink (one polyline per data stroke /
        // pointer cycle) so grouped strokes contribute every stroke
        // they actually drew, not just the first-in-group.
        appendRetainedStroke(m, points);
        const charData: CharStrokeData = {
          character: currentCharacter,
          strokeNum: logicalStrokeNum,
          matched: true,
          similarity: computeSimilarity(
            getMountStroke(m, dataStrokeNum),
            points,
            leniency,
          ),
          points,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: logicalStrokesRemaining(dataStrokeNum, hwData.strokesRemaining, true),
        };

        if (m.pendingEndingCheck != null) {
          charData.strokeEnding = m.pendingEndingCheck;
          m.pendingEndingCheck = null;
        }

        if (isFirstInGroup(dataStrokeNum) || !strokeGroups) {
          // Record the stroke for `Char.result()`: only the first
          // data stroke of each logical group counts (matches what we
          // surface to the public callback).
          const stroke: CharStrokeResult = {
            matched: true,
            similarity: charData.similarity,
            points: charData.points,
            mistakesOnStroke: hwData.mistakesOnStroke,
            isBackwards: hwData.isBackwards,
          };
          if (charData.strokeEnding !== undefined) {
            stroke.strokeEnding = charData.strokeEnding;
          }
          m.perStroke[logicalStrokeNum] = stroke;
          m.totalMistakes = hwData.totalMistakes;
          m.options.onCorrectStroke?.(charData);
        }
      },

      onMistake: (hwData) => {
        const logicalStrokeNum = getLogicalStrokeNum(hwData.strokeNum);
        const points = getCapturedPoints(m);
        const charData: CharStrokeData = {
          character: currentCharacter,
          strokeNum: logicalStrokeNum,
          matched: false,
          similarity: computeSimilarity(
            getMountStroke(m, hwData.strokeNum),
            points,
            leniency,
          ),
          points,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: logicalStrokesRemaining(hwData.strokeNum, hwData.strokesRemaining, false),
        };
        log?.(`mistake: data=${hwData.strokeNum} logical=${logicalStrokeNum}`);
        // Skip the perStroke overwrite when this onMistake is the
        // strokeEndingAsMiss=true follow-up of an ending-check
        // failure that already wrote { matched: true, strokeEnding } to
        // the same logical stroke. Without this guard the ending data
        // would be clobbered with matched=false.
        if (m.skipNextOnMistakeStroke === logicalStrokeNum) {
          m.skipNextOnMistakeStroke = null;
          m.totalMistakes = hwData.totalMistakes;
        } else {
          // A miss leaves perStroke[logicalStrokeNum] flagged as
          // unmatched until the user retries and lands a correct
          // stroke, which overwrites this entry from the
          // onCorrectStroke path.
          m.perStroke[logicalStrokeNum] = {
            matched: false,
            similarity: charData.similarity,
            points: charData.points,
            mistakesOnStroke: hwData.mistakesOnStroke,
            isBackwards: hwData.isBackwards,
          };
          m.totalMistakes = hwData.totalMistakes;
        }
        m.options.onMistake?.(charData);
      },

      onComplete: (summary) => {
        // Swallow the trailing `click` that the browser dispatches
        // right after this `pointerup`, so click-to-inspect consumers
        // never see the gesture that just finalized the quiz.
        armTrailingClickGuard(m);
        m.quizActive = false;
        stopTimingTracking(m);
        log?.(`complete: totalMistakes=${summary.totalMistakes} strokeEndingMistakes=${m.strokeEndingMistakes}`);
        m.options.onComplete?.({
          character: summary.character,
          totalMistakes: summary.totalMistakes,
          strokeEndingMistakes: m.strokeEndingMistakes,
          // Per-stroke quiz only ever fires onComplete on full
          // acceptance — the user retries individual strokes until
          // every one matches — so `matched: true` and `attempts: 1`
          // are constants here.
          matched: true,
          attempts: 1,
        });
      },
    });

    Promise.resolve(quizPromise).then(() => {
      if (destroyed || mounted !== m) {
        return;
      }
      patchQuizForEnding(m);
    });
  }

  /**
   * Per-char correction: arm pointer handlers that snapshot every
   * completed pointer cycle into `m.perCharCaptures` and, once the
   * captured count matches the character's logical stroke count, drive
   * the internal checker over every captured stroke and fire
   * `onComplete` with the aggregated verdict.
   *
   * The existing `startTimingTracking()` already populates
   * `m.timedPoints` for the active pointer cycle. These per-char hooks
   * attach in bubble phase so they always run after the capture-phase
   * timing handlers, i.e. `m.timedPoints` is up to date and
   * `m.pointerProjection` is set when we read them here.
   *
   * `m.perCharCaptures === null` is the single "is per-char accepting
   * input?" gate: nulling it (in onPointerUp once all strokes are in,
   * or in stopPerCharCycle on teardown) makes pointer events become
   * no-ops, so subsequent input during the async finalize window
   * can't append new polylines or recheck.
   */
  function startPerCharCycle(m: MountState): void {
    m.perCharCaptures = [];

    // Mirror per-stroke quiz behavior: blank the main character so the
    // user actually writes onto an empty cell. The outline (per
    // showOutline) stays as a reference, just like the default quiz UX.
    // Swallow rejections (animation interrupted, mount torn down
    // mid-fade) to avoid unhandled-promise noise — symmetric with the
    // showCharacter() call in finalizePerChar.
    m.hw.hideCharacter().catch((err: unknown) => {
      log?.(`per-char hideCharacter failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    const onPointerMove = (_e: PointerEvent) => {
      // Stop accepting input the moment captures are nulled (after the
      // last release, or on teardown) so we don't keep extending a
      // polyline for a stroke that won't be checked.
      if (!m.perCharCaptures) {
        return;
      }
      const polyline = m.perCharLivePolyline;
      if (!polyline) {
        return;
      }
      // m.timedPoints is the per-cycle buffer: `startTimingTracking`'s
      // pointerdown handler runs in capture phase (before this) and
      // resets it for the new stroke, so we are guaranteed to be
      // looking at only the current stroke's samples here.
      updateLivePolylinePoints(m, polyline, m.timedPoints);
    };

    const onPointerUp = (_e: PointerEvent) => {
      const polyline = m.perCharLivePolyline;
      m.perCharLivePolyline = null;
      const captures = m.perCharCaptures;
      if (!captures) {
        // Post-finalize stray release: there's no live polyline because
        // onPointerDown short-circuited too, so nothing to clean up.
        return;
      }
      const points = getCapturedPoints(m);
      // Filter out taps with no real movement (pointerdown + pointerup
      // at the same coords): hanzi-writer's pointerup handler appends a
      // synthetic release sample at the last-move position, so a tap
      // shows up as ≥2 identical points. Anything that didn't actually
      // travel any distance is treated as cancelled, not a stroke.
      const moved = points.length >= 2
        && points.some((p) => p.x !== points[0].x || p.y !== points[0].y);
      if (!moved) {
        // Tap with no movement: drop the empty polyline we created on
        // pointerdown so the overlay doesn't accumulate empty nodes.
        polyline?.remove();
        return;
      }
      captures.push(points);
      // Lock in the final polyline geometry. The live updater already
      // matches the captured points, but redo it once to make sure the
      // saved polyline reflects the released stroke exactly.
      if (polyline) {
        updateLivePolylinePoints(m, polyline, points);
      }

      // Wait until the user has drawn every stroke before judging.
      // Resolve the expected count fresh on every release: hanzi-writer
      // loads character data asynchronously and it may not be available
      // yet when startQuiz() ran.
      const charStrokeCount =
        strokeGroups?.length ?? characterData?.strokes.length ?? 0;
      if (charStrokeCount === 0 || captures.length < charStrokeCount) {
        return;
      }

      // All strokes are in. Nulling captures here AND bumping the
      // per-attempt token make subsequent pointer events no-ops AND let
      // an in-flight finalizePerChar tell when it's been superseded.
      m.perCharCaptures = null;
      const seq = ++m.perCharSeq;
      if (m.options.correction === "deferred") {
        // Deferred mode: stash the buffer + tell the caller we're
        // ready. Tear down input capture now so the user can't keep
        // drawing into a buffer the next `check()` would consume.
        // Correction itself runs only when `Char.check()` is called.
        //
        // Hand the consumer its own deep copy so they can't mutate
        // the strokes/points we'll later replay through correction
        // (TypeScript's ReadonlyArray doesn't protect at runtime).
        // Stashing `captures` directly is safe: it never leaks outside
        // kakitori again.
        m.deferredCaptures = { captures, strokeCount: charStrokeCount };
        stopPerCharCycle(m);
        stopTimingTracking(m);
        const consumerCopy = captures.map((stroke) =>
          stroke.map((p) => ({ x: p.x, y: p.y, t: p.t })),
        );
        m.options.onCharCaptured?.(consumerCopy);
        return;
      }
      // Per-char: run correction in the background.
      finalizePerChar(m, captures, charStrokeCount, seq).catch((err) => {
        log?.(`per-char finalize failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    };

    const onPointerDown = (_e: PointerEvent) => {
      // Same captures gate as onPointerMove/onPointerUp: if we already
      // sent the batch off to check (or got torn down), creating a
      // new polyline would leak into the overlay because onPointerUp's
      // !captures branch returns without cleaning it up.
      if (!m.perCharCaptures) {
        return;
      }
      // Single-pointer guard. Kanji practice is inherently one stroke
      // at a time; a second simultaneous pointerdown (multi-touch, or
      // a stray secondary pointer the browser routes to this target)
      // would otherwise overwrite m.perCharLivePolyline and orphan the
      // first stroke's element in the overlay. Ignore the secondary
      // pointer entirely until the first one releases.
      if (m.perCharLivePolyline) {
        return;
      }
      // Pre-create an empty polyline for the new stroke so pointermove
      // can grow it live (rather than waiting for pointerup to flash a
      // completed shape in). startTimingTracking() runs in capture
      // phase before this, so m.pointerProjection is already set.
      m.perCharLivePolyline = createLivePolyline(m);
    };

    const onPointerCancel = (_e: PointerEvent) => {
      // The browser took the pointer away from us mid-stroke (OS
      // scroll/zoom takeover, contextmenu, palm rejection, etc.).
      // pointerup will NOT fire for this cycle, so without explicit
      // cleanup the live polyline stays on the overlay as an orphan
      // AND the cycle stalls (captures never reaches charStrokeCount).
      // Treat the cancelled stroke like a zero-distance tap: drop the
      // in-progress polyline and wait for the user to redraw.
      const polyline = m.perCharLivePolyline;
      m.perCharLivePolyline = null;
      polyline?.remove();
    };

    m.perCharOnPointerDown = onPointerDown;
    m.perCharOnPointerMove = onPointerMove;
    m.perCharOnPointerUp = onPointerUp;
    m.perCharOnPointerCancel = onPointerCancel;
    // Bubble phase here so we run AFTER the timing handlers (which use
    // the capture phase to make sure release samples land before
    // hanzi-writer would consume the event).
    m.layerEl.addEventListener("pointerdown", onPointerDown);
    m.layerEl.addEventListener("pointermove", onPointerMove);
    m.layerEl.addEventListener("pointerup", onPointerUp);
    m.layerEl.addEventListener("pointercancel", onPointerCancel);
  }

  function stopPerCharCycle(m: MountState): void {
    if (m.perCharOnPointerDown) {
      m.layerEl.removeEventListener("pointerdown", m.perCharOnPointerDown);
      m.perCharOnPointerDown = null;
    }
    if (m.perCharOnPointerMove) {
      m.layerEl.removeEventListener("pointermove", m.perCharOnPointerMove);
      m.perCharOnPointerMove = null;
    }
    if (m.perCharOnPointerUp) {
      m.layerEl.removeEventListener("pointerup", m.perCharOnPointerUp);
      m.perCharOnPointerUp = null;
    }
    if (m.perCharOnPointerCancel) {
      m.layerEl.removeEventListener("pointercancel", m.perCharOnPointerCancel);
      m.perCharOnPointerCancel = null;
    }
    m.perCharCaptures = null;
    m.perCharLivePolyline = null;
    // Invalidate any finalizePerChar that's still awaiting in the
    // background so it doesn't write into freshly-cleared state when
    // its per-stroke awaits resolve.
    m.perCharSeq++;
  }

  /**
   * Build a `<polyline>` element for a single in-progress per-char
   * stroke, sized to match {@link paintUserPolyline}'s styling, and
   * append it to the retained overlay. Returns the element so
   * pointermove can keep extending its `points` attribute.
   */
  function createLivePolyline(m: MountState): SVGPolylineElement | null {
    const group = ensureRetainedSvg(m);
    if (!group) {
      return null;
    }
    const innerSize = m.size - 2 * m.padding;
    const hwToDisplayScale = innerSize / HANZI_PRESCALED_SIZE;
    const strokeWidth =
      m.options.retainedStrokeWidth ??
      (m.options.drawingWidth ?? 4) * hwToDisplayScale;
    const stroke =
      m.options.retainedStrokeColor ?? m.options.drawingColor ?? "#555";
    const ns = "http://www.w3.org/2000/svg";
    const polyline = document.createElementNS(ns, "polyline");
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", stroke);
    polyline.setAttribute("stroke-width", String(strokeWidth));
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    group.appendChild(polyline);
    return polyline;
  }

  /**
   * Recompute the `points` attribute on a live polyline from a fresh
   * pointer sample buffer. Shares the same inverse-projection math as
   * {@link computeRetainedStrokeAttrs} so per-stroke retained ink and
   * per-char live ink land in identical coords.
   */
  function updateLivePolylinePoints(
    m: MountState,
    polyline: SVGPolylineElement,
    points: ReadonlyArray<TimedPoint>,
  ): void {
    const proj = m.pointerProjection;
    if (!proj) {
      return;
    }
    const layerRect = m.layerEl.getBoundingClientRect();
    const attrs = computeRetainedStrokeAttrs(
      points,
      proj,
      layerRect,
      m.size,
      m.padding,
      m.options,
    );
    if (!attrs) {
      return;
    }
    polyline.setAttribute("points", attrs.points);
  }

  /**
   * Check each buffered per-char stroke through the headless checker
   * (reused via `ensureChecker(allowMount=true)`), populate
   * `m.perStroke`, then fire `onCorrectStroke` / `onMistake` per
   * stroke followed by `onComplete`.
   *
   * `seq` is the per-attempt token captured at entry. If it changes
   * between awaits (because reset() / start() / unmount() bumped it
   * via stopPerCharCycle), the loop bails out without writing into
   * the freshly-cleared state.
   *
   * When `checkStrokeImpl` throws (infrastructure failure, distinct
   * from a matcher rejection), the stroke gets a placeholder
   * `{matched: false}` entry in perStroke for visibility but is NOT
   * counted toward `totalMistakes` and does NOT fire `onMistake` —
   * a flaky checker shouldn't show up as "the user wrote it wrong".
   */
  async function finalizePerChar(
    m: MountState,
    captures: TimedPoint[][],
    strokeCount: number,
    seq: number,
  ): Promise<void> {
    log?.(`per-char finalize: strokes=${strokeCount}`);
    let charMatched = true;
    for (let strokeNum = 0; strokeNum < strokeCount; strokeNum++) {
      const points = captures[strokeNum];
      let verdict: CharStrokeResult;
      let checkerError = false;
      try {
        verdict = await checkStrokeImpl(strokeNum, points, {}, true);
      } catch (err) {
        log?.(`per-char check stroke ${strokeNum} failed: ${err instanceof Error ? err.message : String(err)}`);
        verdict = { matched: false, similarity: 0, points };
        checkerError = true;
      }
      if (destroyed || mounted !== m || m.perCharSeq !== seq) {
        return;
      }
      m.perStroke[strokeNum] = verdict;
      // Flip `charMatched` for ANY unmatched verdict — including the
      // checkerError fallback that forces `matched: false`. Otherwise
      // an infrastructure failure would skip the retry path and let
      // the OK completion fire while `Char.result().matched` reads
      // false, leaving callers with inconsistent verdicts.
      if (!verdict.matched) {
        charMatched = false;
      }
      if (checkerError) {
        // Infrastructure failure: keep the placeholder in perStroke
        // (so the caller can see SOMETHING for this stroke index) but
        // don't pretend it was a user mistake and don't dispatch the
        // mistake callback.
        continue;
      }
      if (!verdict.matched) {
        m.totalMistakes += 1;
      }
      if (verdict.strokeEnding && !verdict.strokeEnding.correct) {
        m.strokeEndingMistakes += 1;
      }
      const charData: CharStrokeData = {
        character: currentCharacter,
        strokeNum,
        matched: verdict.matched,
        similarity: verdict.similarity,
        points: verdict.points ?? points,
        isBackwards: verdict.isBackwards ?? false,
        mistakesOnStroke: 0,
        totalMistakes: m.totalMistakes,
        strokesRemaining: strokeCount - strokeNum - 1,
      };
      if (verdict.strokeEnding) {
        charData.strokeEnding = verdict.strokeEnding;
      }
      // Route through `onCorrectStroke` / `onMistake` based on the
      // matcher verdict so consumers that filter by callback name keep
      // working in per-char mode. `mistakesOnStroke` stays 0 (there is
      // no guided-write retry count in per-char), but `matched: false`
      // means the stroke was rejected and belongs on the mistake path.
      if (verdict.matched) {
        m.options.onCorrectStroke?.(charData);
      } else {
        m.options.onMistake?.(charData);
      }
    }
    if (destroyed || mounted !== m || m.perCharSeq !== seq) {
      return;
    }
    // `maxRetries` gates the in-place retry branches below. If the
    // attempt was NG but the user has already consumed every allowed
    // retry, fall through to the OK completion path with the
    // accumulated NG verdict so `onComplete` fires with
    // `matched: false` and the cell / block / page commit chain
    // settles instead of stalling.
    const maxRetries = m.options.maxRetries;
    const retriesExhausted =
      maxRetries !== undefined && m.retries >= maxRetries;
    if (!charMatched && !retriesExhausted && m.options.correction === "deferred") {
      // Deferred mode (block / page driven): finalize ran via an
      // explicit Char.check() from the higher-level coordinator. NG
      // verdict on a deferred char follows the same in-place retry
      // model as per-char: wipe the retained ink, re-start the
      // per-char capture cycle, and surface the rejection through
      // {@link onCharRejected} so the block / page coordinator can
      // reverse its "captured" bookkeeping (re-add to pending, reset
      // the triggered flag) and accept the user's next attempt as a
      // fresh capture.
      //
      // Counters and onComplete are held back exactly like the
      // per-char path; the cycle had been torn down at capture-fill
      // (line ~1201, including stopTimingTracking), so unlike
      // per-char we must explicitly re-attach BOTH the timing tracker
      // and the per-char pointer handlers before the user can write
      // another attempt.
      clearRetainedStrokes(m);
      m.perStroke = [];
      m.perCharSeq++;
      m.retries += 1;
      startTimingTracking(m);
      startPerCharCycle(m);
      log?.(`deferred NG attempt: re-armed for retry (retries=${m.retries})`);
      m.options.onCharRejected?.({
        character: currentCharacter,
        totalMistakes: m.totalMistakes,
        strokeEndingMistakes: m.strokeEndingMistakes,
        attempts: m.retries,
      });
      return;
    }
    if (!charMatched && !retriesExhausted && m.options.correction === "per-char") {
      // NG attempt: mirror per-stroke's "user keeps retrying until the
      // whole character matches" semantics at char granularity. Wipe
      // the retained ink (already painted live as the user wrote) and
      // re-arm the capture buffer so the next pointer cycle begins a
      // fresh attempt at stroke 0. Pointer handlers and the timing
      // tracker stay attached; perCharSeq is bumped so the next batch
      // gets its own finalize token without colliding with this one.
      //
      // - Accumulated counters (totalMistakes, strokeEndingMistakes)
      //   stay so onComplete eventually reports the total mistake
      //   count across every retry, the same way per-stroke surfaces
      //   it through hanzi-writer's totalMistakes.
      // - perStroke is wiped so the next attempt's verdicts replace
      //   this attempt's; we don't want OK strokes from a half-good
      //   retry to be remembered as if they belonged to the final
      //   accepted attempt.
      // - We do NOT fire onComplete, stopPerCharCycle, stopTiming,
      //   showCharacter, or arm the trailing-click guard — the cycle
      //   isn't done yet.
      clearRetainedStrokes(m);
      m.perStroke = [];
      m.perCharCaptures = [];
      m.perCharSeq++;
      m.retries += 1;
      log?.(`per-char NG attempt: re-armed for retry (retries=${m.retries})`);
      m.options.onCharRejected?.({
        character: currentCharacter,
        totalMistakes: m.totalMistakes,
        strokeEndingMistakes: m.strokeEndingMistakes,
        attempts: m.retries,
      });
      return;
    }
    // Swallow the trailing `click` that the browser dispatches right
    // after this `pointerup`, so click-to-inspect consumers never see
    // the gesture that just finalized the per-char cycle.
    armTrailingClickGuard(m);
    m.quizActive = false;
    // Detach the per-char pointer hooks AND the timing tracker now that
    // the character is finalized. The per-stroke path tears down via
    // hw.quiz's onComplete → stopTimingTracking; per-char must do the
    // same explicitly so the layer doesn't keep accumulating events
    // until reset() / unmount(). Note: stopPerCharCycle bumps
    // perCharSeq, so we must read m.options.retainStrokes / call
    // clearRetainedStrokes / fire onComplete BEFORE the next attempt
    // could possibly start.
    stopPerCharCycle(m);
    stopTimingTracking(m);
    // The drawn polylines were painted unconditionally to give the user
    // mid-stroke feedback. Now that check is done:
    //
    // - If `retainStrokes` is off, wipe every polyline so per-char
    //   matches the per-stroke default UX (no leftover ink).
    // - If any stroke was rejected, also wipe — mirroring per-stroke,
    //   where hanzi-writer's quiz visually consumes mismatched strokes
    //   so only correct ones ever accumulate. At per-char granularity
    //   the natural mirror is "all-or-nothing per character": one bad
    //   stroke means the user has to rewrite the whole char, so
    //   leaving partial NG ink behind would be misleading.
    if (!m.options.retainStrokes || !charMatched) {
      clearRetainedStrokes(m);
    }
    // Per-char hid the character at startPerCharCycle so the user wrote
    // onto a blank cell. Per-stroke's quiz uses `strokeColor` to control
    // the post-accept ink, but per-char doesn't go through quiz, so we
    // mirror the same semantic here: reveal the official character at
    // correction time iff the caller wants it (showAcceptedStroke is
    // the public opt-out, default true). Plain `showCharacter()` is a
    // straight fade across all strokes — no per-stroke animation, no
    // highlight color flash, no stroke-count surprises. The reveal is
    // purely cosmetic, so the promise is fire-and-forget.
    if (m.options.showAcceptedStroke !== false) {
      m.hw.showCharacter().catch((err: unknown) => {
        log?.(`per-char showCharacter failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    log?.(`per-char complete: totalMistakes=${m.totalMistakes} strokeEndingMistakes=${m.strokeEndingMistakes} matched=${charMatched} attempts=${m.retries + 1}`);
    m.options.onComplete?.({
      character: currentCharacter,
      totalMistakes: m.totalMistakes,
      strokeEndingMistakes: m.strokeEndingMistakes,
      // `charMatched` is the verdict of the final attempt — true on
      // an OK landing, false when `maxRetries` was finite and the
      // user exhausted every retry. `attempts` is 1-indexed: the
      // first attempt is `1`, so after N retries it lands at `N + 1`.
      matched: charMatched,
      attempts: m.retries + 1,
    });
  }

  /**
   * Public trigger for `correction: "deferred"` mounts: runs
   * correction on the buffer that {@link onCharCaptured} announced.
   * The actual logic is the same finalize-and-dispatch path per-char
   * uses; we just call it on demand instead of automatically.
   */
  function check(): Char {
    if (!mounted) {
      log?.("char.check(): no mounted instance");
      return api;
    }
    const m = mounted;
    const stash = m.deferredCaptures;
    if (!stash) {
      log?.("char.check(): no buffered captures to correct");
      return api;
    }
    m.deferredCaptures = null;
    const seq = ++m.perCharSeq;
    finalizePerChar(m, stash.captures, stash.strokeCount, seq).catch(
      (err: unknown) => {
        log?.(`char.check(): finalize failed: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
    return api;
  }

  /** Build the animate-overlay and play it on top of the mounted SVG. */
  async function animateWithGroups(m: MountState): Promise<void> {
    const rawSpeed = m.options.strokeAnimationSpeed ?? 1;
    const speed = Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 1;
    if (speed !== rawSpeed) {
      log?.(`strokeAnimationSpeed must be a positive finite number, got ${rawSpeed}; falling back to 1`);
    }
    const delayBetweenStrokes = m.options.delayBetweenStrokes ?? 1000;
    const strokeColor = m.options.strokeColor ?? "#555";
    const outlineColor = m.options.outlineColor ?? "#DDD";

    const charData = (await m.hw.getCharacterData()) as unknown as HanziCharacterData;
    const dataStrokes = charData.strokes;

    const resolvedStrokeGroups = strokeGroups
      ?? Array.from({ length: dataStrokes.length }, (_, i) => [i]);

    const localHwSvg = m.hwSvg;
    if (!localHwSvg) {
      return;
    }
    const width = localHwSvg.getAttribute("width") || "300";
    const height = localHwSvg.getAttribute("height") || "300";

    const PATH_LENGTH = 3333;
    const DASH_ARRAY = 3337;
    const DASH_OFFSET = 3339;
    const BASE_STROKE_DURATION = 0.8 / speed;

    const strokeLengths = dataStrokes.map((s) =>
      computeMedianPathLength(s.points as Array<{ x: number; y: number }>),
    );
    const strokeDurations = strokeLengths.map(
      (len) => (len / HANZI_PRESCALED_SIZE) * BASE_STROKE_DURATION,
    );

    const strokeDelays: number[] = Array.from({ length: dataStrokes.length }, () => 0);
    let currentDelay = 0;
    for (let gi = 0; gi < resolvedStrokeGroups.length; gi++) {
      if (gi > 0) {
        currentDelay += delayBetweenStrokes / 1000;
      }
      const groupDelay = currentDelay;
      let groupMaxDuration = 0;
      for (const dataIdx of resolvedStrokeGroups[gi]) {
        if (dataIdx < 0 || dataIdx >= dataStrokes.length) {
          continue;
        }
        strokeDelays[dataIdx] = groupDelay;
        if (strokeDurations[dataIdx] > groupMaxDuration) {
          groupMaxDuration = strokeDurations[dataIdx];
        }
      }
      currentDelay += groupMaxDuration;
    }
    let totalTime = 0;
    for (let i = 0; i < dataStrokes.length; i++) {
      const end = strokeDelays[i] + strokeDurations[i];
      if (end > totalTime) {
        totalTime = end;
      }
    }

    const ns = "http://www.w3.org/2000/svg";
    const overlaySvg = document.createElementNS(ns, "svg");
    overlaySvg.classList.add("kakitori-anim");
    overlaySvg.setAttribute("width", width);
    overlaySvg.setAttribute("height", height);
    overlaySvg.style.position = "absolute";
    overlaySvg.style.top = "0";
    overlaySvg.style.left = "0";
    overlaySvg.style.zIndex = "2";
    overlaySvg.style.pointerEvents = "none";

    const hwGroup = localHwSvg.querySelector(":scope > g");
    const hwTransform = hwGroup?.getAttribute("transform") || "";

    const flipGroup = document.createElementNS(ns, "g");
    flipGroup.setAttribute("transform", hwTransform);

    const styleEl = document.createElementNS(ns, "style");
    styleEl.textContent = `
      @keyframes kakitori-zk {
        to {
          stroke-dashoffset: 0;
        }
      }
      svg.kakitori-anim path[clip-path] {
        animation: kakitori-zk var(--t) linear forwards var(--d);
        stroke-dasharray: ${DASH_ARRAY};
        stroke-dashoffset: ${DASH_OFFSET};
        stroke-width: 128;
        stroke-linecap: round;
        fill: none;
        stroke: ${strokeColor};
      }
      svg.kakitori-anim path[id] { fill: ${outlineColor}; }
    `;
    overlaySvg.appendChild(styleEl);

    const defs = document.createElementNS(ns, "defs");

    for (let i = 0; i < dataStrokes.length; i++) {
      const stroke = dataStrokes[i];
      const shapePath = document.createElementNS(ns, "path");
      shapePath.id = `kakitori-d${i}`;
      shapePath.setAttribute("d", stroke.path);
      flipGroup.appendChild(shapePath);

      const clipPath = document.createElementNS(ns, "clipPath");
      clipPath.id = `kakitori-c${i}`;
      const useEl = document.createElementNS(ns, "use");
      useEl.setAttribute("href", `#kakitori-d${i}`);
      clipPath.appendChild(useEl);
      defs.appendChild(clipPath);
    }

    for (let i = 0; i < dataStrokes.length; i++) {
      const stroke = dataStrokes[i];
      const medianPath = document.createElementNS(ns, "path");
      medianPath.setAttribute("pathLength", String(PATH_LENGTH));
      medianPath.setAttribute("clip-path", `url(#kakitori-c${i})`);
      medianPath.style.setProperty("--d", `${strokeDelays[i]}s`);
      medianPath.style.setProperty("--t", `${strokeDurations[i]}s`);
      const d = stroke.points
        .map((p, j) => `${j === 0 ? "M" : "L"}${p.x} ${p.y}`)
        .join("");
      medianPath.setAttribute("d", d);
      flipGroup.appendChild(medianPath);
    }

    overlaySvg.appendChild(defs);
    overlaySvg.appendChild(flipGroup);

    try {
      m.activeOverlay?.remove();
      m.activeOverlay = overlaySvg;
      localHwSvg.style.visibility = "hidden";
      m.layerEl.appendChild(overlaySvg);

      log?.(`animate: ${resolvedStrokeGroups.length} strokes (${dataStrokes.length} data strokes), totalTime=${totalTime.toFixed(1)}s`);

      await new Promise((r) => setTimeout(r, totalTime * 1000 + 200));
    } finally {
      if (m.activeOverlay === overlaySvg) {
        overlaySvg.remove();
        m.activeOverlay = null;
        localHwSvg.style.visibility = "";
      }
    }
  }

  function startAnimation(m: MountState): void {
    animateWithGroups(m).catch((err: unknown) => {
      log?.(`animate failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  function getStrokePaths(m: MountState): SVGPathElement[] {
    const svg = m.hwSvg;
    if (!svg) {
      return [];
    }
    const allGroups = svg.querySelectorAll(":scope > g > g");
    const groupsWithPaths: Element[] = [];
    for (const g of allGroups) {
      if (g.querySelectorAll("path[clip-path]").length > 0) {
        groupsWithPaths.push(g);
      }
    }
    const mainGroup = groupsWithPaths[1];
    if (!mainGroup) {
      return [];
    }
    return Array.from(mainGroup.querySelectorAll("path[clip-path]")) as SVGPathElement[];
  }

  /**
   * Arm a one-shot trailing-click guard on the layer. The browser
   * dispatches a synthetic `click` event after every `pointerup`,
   * including the `pointerup` that completes the last stroke of a quiz
   * or per-char cycle. That trailing click reaches `boundOnClick` AFTER
   * `quizActive` has already flipped false, so the consumer's onClick
   * (typically click-to-inspect via {@link setStrokeColor}) would
   * recolor the just-finalized stroke and clobber the `strokeColor` /
   * `showAcceptedStroke` contract.
   *
   * Strategy: install a capture-phase listener on `m.layerEl` that
   * `stopImmediatePropagation()`s the next click (capture-phase
   * listeners on the target element fire before bubble-phase listeners
   * on the same element, so `boundOnClick` never sees it), then tears
   * itself down. The guard also disarms on the next `pointerdown` —
   * that signals a genuine new gesture, so its eventual click must
   * pass through normally. A fallback timeout covers touch / pen
   * devices that may not emit a synthetic click.
   *
   * Idempotent: re-arming disarms any previous guard first.
   */
  function armTrailingClickGuard(m: MountState): void {
    if (m.trailingClickGuard) {
      m.trailingClickGuard();
    }
    const layer = m.layerEl;
    let armed = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const teardown = (): void => {
      if (!armed) {
        return;
      }
      armed = false;
      layer.removeEventListener("click", onClick, true);
      layer.removeEventListener("pointerdown", onPointerDown, true);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (m.trailingClickGuard === teardown) {
        m.trailingClickGuard = null;
      }
    };
    const onClick = (e: MouseEvent): void => {
      e.stopImmediatePropagation();
      teardown();
    };
    const onPointerDown = (): void => {
      teardown();
    };
    layer.addEventListener("click", onClick, true);
    layer.addEventListener("pointerdown", onPointerDown, true);
    timer = setTimeout(teardown, 200);
    m.trailingClickGuard = teardown;
  }

  function cancelActiveAnimation(m: MountState): void {
    if (m.activeOverlay) {
      m.activeOverlay.remove();
      m.activeOverlay = null;
    }
    if (m.hwSvg) {
      m.hwSvg.style.visibility = "";
    }
  }

  function cancelActiveQuiz(m: MountState): void {
    const wasActive = m.quizActive;
    m.quizActive = false;
    if (m.trailingClickGuard) {
      m.trailingClickGuard();
    }
    m.hw.cancelQuiz();
    stopTimingTracking(m);
    stopPerCharCycle(m);
    m.strokeEndingMistakes = 0;
    m.totalMistakes = 0;
    m.retries = 0;
    m.perStroke = [];
    m.skipNextOnMistakeStroke = null;
    m.pendingEndingCheck = null;
    // Drop any stashed deferred-correction buffer too: the cell is
    // being abandoned (reset / start / undo / unmount), so the
    // pending captures must NOT survive into a fresh attempt or a
    // post-teardown `Char.check()` call.
    m.deferredCaptures = null;
    if (wasActive) {
      m.hw.setCharacter(currentCharacter).catch((err: unknown) => {
        log?.(`cancelActiveQuiz reload failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  // ===== check implementation (offscreen HW) =====
  async function ensureChecker(allowMount = false): Promise<CheckerState> {
    assertNotDestroyed();
    if (!allowMount && mounted) {
      throw new Error(
        "char: checkStroke() is not supported on a mounted instance. Create a separate Char (without mount) for headless checking.",
      );
    }
    if (checker) {
      return checker;
    }
    // Memoize the in-flight init so concurrent checkStroke() calls (e.g.
    // Promise.all) share a single offscreen container instead of each
    // racing to create its own and leaking the losers.
    if (checkerInit) {
      return checkerInit;
    }
    checkerInit = (async (): Promise<CheckerState> => {
      // Off-screen container so hanzi-writer's renderer can mount and the
      // matcher (which runs through endUserStroke -> renderState) does not
      // throw on missing layout.
      //
      // Hiding strategy avoids any user-visible side effects:
      // - `position: fixed` keeps the box out of the document flow without
      //   risking a horizontal scrollbar (which `left: -9999px` can cause
      //   when the host page lacks `overflow-x: hidden`).
      // - `visibility: hidden` removes it from rendering and hit-testing.
      // - `pointer-events: none` belt-and-braces guard against stray events.
      // - `aria-hidden="true"` keeps the offscreen mount out of the a11y
      //   tree so screen readers do not see two copies of the character.
      // - `contain: strict` confines layout / paint to the box, so even
      //   the briefly-visible ancestors during hanzi-writer's render path
      //   cannot perturb the host page.
      const container = document.createElement("div");
      container.setAttribute("aria-hidden", "true");
      container.style.position = "fixed";
      container.style.top = "0";
      container.style.left = "0";
      container.style.width = `${HANZI_PRESCALED_SIZE}px`;
      container.style.height = `${HANZI_PRESCALED_SIZE}px`;
      container.style.visibility = "hidden";
      container.style.pointerEvents = "none";
      container.style.contain = "strict";
      document.body.appendChild(container);

      try {
        const hw = HanziWriter.create(container, currentCharacter, {
          width: HANZI_PRESCALED_SIZE,
          height: HANZI_PRESCALED_SIZE,
          padding: 0,
          charDataLoader,
          // Keep hint/highlight off so the matcher path stays as plain as
          // possible; tome/hane/harai check is layered on top of isMatch.
          showHintAfterMisses: false,
          highlightOnComplete: false,
          ...(leniency != null ? { leniency } : {}),
        });
        // hw.quiz() can return a Promise that rejects (e.g. when the
        // char-data loader fails). Capture the failure so the polling
        // loop below surfaces the underlying error instead of timing out
        // with a misleading "quiz did not initialise" message; also
        // attach a no-op catch so the rejection does not bubble up as an
        // unhandled rejection while the loop is still running.
        let quizFailure: unknown = null;
        Promise.resolve(hw.quiz({})).catch((err: unknown) => {
          quizFailure = err;
        });

        // Wait for the internal _quiz to be ready (hanzi-writer initialises
        // it asynchronously after the character data resolves).
        let quiz: HanziQuiz | undefined;
        for (let i = 0; i < 200 && !quiz; i++) {
          if (quizFailure) {
            throw quizFailure instanceof Error
              ? quizFailure
              : new Error(`char.checkStroke(): hanzi-writer quiz init failed: ${String(quizFailure)}`);
          }
          quiz = (hw as unknown as { _quiz?: HanziQuiz })._quiz;
          if (!quiz) {
            await new Promise((r) => setTimeout(r, 5));
          }
        }
        if (!quiz) {
          if (quizFailure) {
            throw quizFailure instanceof Error
              ? quizFailure
              : new Error(`char.checkStroke(): hanzi-writer quiz init failed: ${String(quizFailure)}`);
          }
          throw new Error("char.checkStroke(): timed out waiting for hanzi-writer quiz to initialise.");
        }
        // The await above could have spanned a destroy() or mount() call.
        // Bail rather than leave a fully-initialised checker lying around
        // alongside a mounted writer or after teardown.
        if (destroyed) {
          throw new Error("char: instance has been destroyed and cannot be used.");
        }
        if (!allowMount && mounted) {
          throw new Error(
            "char: checkStroke() is not supported on a mounted instance. Create a separate Char (without mount) for headless checking.",
          );
        }

        const characterImpl = (hw as unknown as {
          _character: { strokes: Array<{ getAverageDistance(points: Pt[]): number }> };
        })._character;

        const j: CheckerState = {
          container,
          hw,
          character: characterImpl,
          perStroke: [],
          capture: null,
        };

        // Patch the success / failure handlers so we capture the matcher's
        // verdict without letting hanzi-writer's render-state side effects
        // advance internal stroke counters; the checker drives the index
        // manually instead.
        quiz._handleSuccess = (meta) => {
          j.capture = { matched: true, isBackwards: meta.isStrokeBackwards };
        };
        quiz._handleFailure = (meta) => {
          j.capture = { matched: false, isBackwards: meta.isStrokeBackwards };
        };

        checker = j;
        return j;
      } catch (err) {
        // Drop the container so a future check() can retry from scratch
        // instead of leaving an orphaned hidden node behind.
        container.remove();
        // Clear the memo so the next check() retries instead of always
        // reusing the failed promise.
        checkerInit = null;
        throw err;
      }
    })();
    return checkerInit;
  }

  async function checkStroke(
    strokeNum: number,
    points: TimedPoint[],
    opts: CharCheckStrokeOptions = {},
  ): Promise<CharStrokeResult> {
    assertNotDestroyed();
    if (mounted) {
      throw new Error(
        "char: checkStroke() is not supported on a mounted instance. Create a separate Char (without mount) for headless checking.",
      );
    }
    // Flag synchronously so a mount() called immediately after check()
    // (before any await unfreezes ensureChecker) still sees that judging
    // has started.
    checkStarted = true;
    return checkStrokeImpl(strokeNum, points, opts, false);
  }

  /**
   * Shared check implementation used by both the public {@link check}
   * (headless mode) and per-char correction on a mounted instance. The
   * `allowMount` flag toggles the mount-coexistence guard inside
   * {@link ensureChecker}.
   */
  async function checkStrokeImpl(
    strokeNum: number,
    points: TimedPoint[],
    opts: CharCheckStrokeOptions,
    allowMount: boolean,
  ): Promise<CharStrokeResult> {
    if (!Number.isInteger(strokeNum) || strokeNum < 0) {
      throw new Error(`char.checkStroke(): strokeNum must be a non-negative integer, got ${strokeNum}`);
    }
    await configReady;
    const j = await ensureChecker(allowMount);

    if (strokeGroups && strokeNum >= strokeGroups.length) {
      throw new Error(
        `char.checkStroke(): strokeNum ${strokeNum} is out of range; strokeGroups configures ${strokeGroups.length} logical stroke(s).`,
      );
    }
    const dataStrokeNum = logicalToFirstDataStroke(strokeNum);
    if (dataStrokeNum >= j.character.strokes.length) {
      throw new Error(
        `char.checkStroke(): strokeNum ${strokeNum} is out of range; the character has ${j.character.strokes.length} data stroke(s).`,
      );
    }
    const quiz = (j.hw as unknown as { _quiz?: HanziQuiz })._quiz;
    if (!quiz) {
      throw new Error("char.checkStroke(): hanzi-writer quiz disappeared between calls.");
    }

    // If a sourceBox was provided, project each point into hanzi-writer's
    // internal coord space (`x ∈ [0, HANZI_PRESCALED_SIZE]`, `y ∈ [HANZI_Y_MIN,
    // HANZI_Y_MAX]` with Y-up). Otherwise assume the caller has already
    // done the projection.
    const internalPoints: TimedPoint[] = opts.sourceBox
      ? projectToInternal(points, opts.sourceBox)
      : points.map((p) => ({ x: p.x, y: p.y, t: p.t }));
    const matcherPoints: Pt[] = internalPoints.map((p) => ({ x: p.x, y: p.y }));

    // Drive the matcher: position the quiz at the requested stroke, set the
    // user stroke to the projected points, and let endUserStroke run
    // strokeMatches. The patched handlers capture the verdict.
    quiz._currentStrokeIndex = dataStrokeNum;
    j.capture = null;
    quiz._userStroke = {
      points: matcherPoints,
      externalPoints: matcherPoints,
    };
    quiz.endUserStroke();

    const captured = j.capture ?? { matched: false, isBackwards: false };

    const similarity = computeSimilarity(
      j.character.strokes[dataStrokeNum],
      matcherPoints,
      leniency,
    );

    // Stroke ending check runs whenever stroke endings are configured for
    // the current logical stroke. Timestamps come from `points` (final
    // sample's `t` is the release moment). Lazily fetch character data for
    // the direction auto-derivation if it has not been loaded yet.
    let strokeEnding: StrokeEndingResult | undefined;
    if (strokeEndings) {
      if (!characterData) {
        characterData = (await j.hw.getCharacterData()) as unknown as HanziCharacterData;
      }
      const endingCheck = computeEndingCheck({
        dataStrokeNum,
        points: internalPoints,
        strokeEndings,
        strokeGroups,
        characterData,
        drawableSize: HANZI_PRESCALED_SIZE,
        strictness: strokeEndingStrictness,
        log,
      });
      if (endingCheck) {
        strokeEnding = endingCheck;
      }
    }

    // Carry the original caller-supplied points (not the
    // internal-projection) so consumers can re-feed them through
    // Char.checkStroke for replay without re-projecting. opts.sourceBox is
    // not part of CharStrokeResult — callers who use a sourceBox should
    // also keep it externally if they want to replay verbatim.
    const strokeResult: CharStrokeResult = strokeEnding
      ? { matched: captured.matched, similarity, strokeEnding, points }
      : { matched: captured.matched, similarity, points };

    j.perStroke[strokeNum] = strokeResult;
    return strokeResult;
  }

  function result(): CharResult {
    assertNotDestroyed();
    // Pull per-stroke history from whichever path actually wrote to it.
    // The mount path lights up while a quiz is active (or just settled);
    // the headless path lights up after check() runs. Mount and check
    // are exclusive on the same instance, so only one source can be
    // populated at any time.
    let perStrokeSrc: ReadonlyArray<CharStrokeResult | undefined> = [];
    let mistakes: number | undefined;
    let strokeEndingMistakes: number | undefined;
    if (mounted && mounted.perStroke.length > 0) {
      perStrokeSrc = mounted.perStroke;
      mistakes = mounted.totalMistakes;
      strokeEndingMistakes = mounted.strokeEndingMistakes;
    } else if (checker) {
      perStrokeSrc = checker.perStroke;
    }
    const perStroke: CharStrokeResult[] = [];
    for (let i = 0; i < perStrokeSrc.length; i++) {
      perStroke.push(perStrokeSrc[i] ?? { matched: false, similarity: 0 });
    }
    // `matched` is rolled up only across observed (real) entries — gaps
    // from out-of-order checkStroke() calls are placeholder slots that exist
    // for indexing convenience and shouldn't drag the rollup to false.
    // Vacuously true when no strokes have been observed yet.
    let matched = true;
    for (let i = 0; i < perStrokeSrc.length; i++) {
      const real = perStrokeSrc[i];
      if (real !== undefined && !real.matched) {
        matched = false;
        break;
      }
    }
    // `complete` flips true once every logical stroke has been observed.
    // Count *real* entries in the source array — out-of-order check()
    // calls grow `perStrokeSrc.length` past the index that was just
    // checked, leaving sparse undefined slots. Comparing the real-entry
    // count against `totalLogicalStrokes` avoids reporting `complete`
    // before every logical stroke has actually been observed.
    const totalLogicalStrokes = getLogicalStrokeCount();
    let observed = 0;
    for (let i = 0; i < totalLogicalStrokes; i++) {
      if (perStrokeSrc[i] !== undefined) {
        observed++;
      }
    }
    const complete = totalLogicalStrokes > 0 && observed === totalLogicalStrokes;
    const out: CharResult = {
      character: currentCharacter,
      complete,
      matched,
      perStroke,
    };
    if (mistakes !== undefined) {
      out.mistakes = mistakes;
    }
    if (strokeEndingMistakes !== undefined) {
      out.strokeEndingMistakes = strokeEndingMistakes;
    }
    return out;
  }

  // ===== mount lifecycle =====
  function mount(target: string | HTMLElement, mountOpts: MountOptions = {}): Char {
    assertNotDestroyed();
    // checkStarted flips synchronously when check() is first called, even
    // before ensureChecker() runs and assigns checkerInit / checker. All
    // three together cover the windows "before the first await", "during
    // init" and "after init succeeded", so the documented mount/check
    // exclusivity holds end-to-end.
    if (checker || checkerInit || checkStarted) {
      throw new Error(
        "char: mount() is not supported after check() has been called. Create a separate Char for mounting.",
      );
    }
    if (mounted) {
      unmount();
    }
    let targetEl: HTMLElement;
    if (typeof target === "string") {
      const found = document.querySelector(target);
      if (!found) {
        throw new Error(`char.mount(): target selector "${target}" did not match any element.`);
      }
      targetEl = found as HTMLElement;
    } else {
      targetEl = target;
    }

    const size = mountOpts.size ?? DEFAULT_SIZE;
    const padding = mountOpts.padding ?? DEFAULT_PADDING;
    validateSizeAndPadding(size, padding, "char.mount()");

    const hwOptions: Partial<HanziWriterOptions> = {
      width: size,
      height: size,
      padding,
      charDataLoader,
    };
    if (mountOpts.strokeColor != null) {
      hwOptions.strokeColor = mountOpts.strokeColor;
    } else if (mountOpts.showAcceptedStroke === false) {
      // hanzi-writer's color parser only accepts `#rgb` / `#rrggbb` /
      // `rgb(...)` / `rgba(...)`, so the keyword "transparent" doesn't
      // round-trip — use a fully-transparent rgba() instead.
      hwOptions.strokeColor = "rgba(0,0,0,0)";
    }
    if (mountOpts.outlineColor != null) {
      hwOptions.outlineColor = mountOpts.outlineColor;
    }
    if (mountOpts.drawingColor != null) {
      hwOptions.drawingColor = mountOpts.drawingColor;
    }
    if (mountOpts.drawingWidth != null) {
      hwOptions.drawingWidth = mountOpts.drawingWidth;
    }
    if (mountOpts.highlightColor != null) {
      hwOptions.highlightColor = mountOpts.highlightColor;
    }
    if (mountOpts.showOutline != null) {
      hwOptions.showOutline = mountOpts.showOutline;
    }
    if (mountOpts.showCharacter != null) {
      hwOptions.showCharacter = mountOpts.showCharacter;
    }
    if (mountOpts.strokeAnimationSpeed != null) {
      hwOptions.strokeAnimationSpeed = mountOpts.strokeAnimationSpeed;
    }
    if (mountOpts.delayBetweenStrokes != null) {
      hwOptions.delayBetweenStrokes = mountOpts.delayBetweenStrokes;
    }

    // Wrap hanzi-writer's SVG in a positioned layer container so the optional
    // grid SVG and the animate() overlay can layer onto it without mutating
    // the user-supplied targetEl.
    const layerEl = document.createElement("div");
    layerEl.style.position = "relative";
    layerEl.style.display = "inline-block";
    layerEl.style.lineHeight = "0";
    targetEl.appendChild(layerEl);

    const hw = HanziWriter.create(layerEl, currentCharacter, hwOptions);

    let hwSvg: SVGSVGElement | null = layerEl.querySelector("svg") as SVGSVGElement | null;
    if (hwSvg) {
      hwSvg.style.position = "relative";
      hwSvg.style.zIndex = "1";
    }

    let gridSvg: SVGSVGElement | null = null;
    if (mountOpts.showGrid) {
      const ns = "http://www.w3.org/2000/svg";
      gridSvg = document.createElementNS(ns, "svg") as SVGSVGElement;
      gridSvg.classList.add("kakitori-grid");
      gridSvg.setAttribute("width", String(size));
      gridSvg.setAttribute("height", String(size));
      gridSvg.setAttribute("aria-hidden", "true");
      gridSvg.style.position = "absolute";
      gridSvg.style.top = "0";
      gridSvg.style.left = "0";
      gridSvg.style.pointerEvents = "none";
      drawCrossGrid(gridSvg, size, mountOpts.showGrid);
      layerEl.insertBefore(gridSvg, layerEl.firstChild);
    }

    const m: MountState = {
      targetEl,
      layerEl,
      hwSvg,
      gridSvg,
      activeOverlay: null,
      retainedGroup: null,
      perCharCaptures: null,
      perCharOnPointerDown: null,
      perCharOnPointerMove: null,
      perCharOnPointerUp: null,
      perCharOnPointerCancel: null,
      perCharLivePolyline: null,
      perCharSeq: 0,
      deferredCaptures: null,
      pendingEndingCheck: null,
      quizActive: false,
      trailingClickGuard: null,
      quizArmed: false,
      retries: 0,
      strokeEndingMistakes: 0,
      perStroke: [],
      totalMistakes: 0,
      skipNextOnMistakeStroke: null,
      isPointerDown: false,
      lastMoveTime: 0,
      releaseTime: 0,
      pointerProjection: null,
      timedPoints: [],
      boundOnPointerDown: null,
      boundOnPointerMove: null,
      boundOnPointerUp: null,
      boundOnClick: null,
      options: mountOpts,
      hw,
      size,
      padding,
    };

    if (mountOpts.onClick) {
      m.boundOnClick = (e: MouseEvent) => {
        // Quiz / per-char active = the writer is in drawing mode; the
        // trailing click event of a drawn stroke must NOT trigger an
        // onClick callback (and especially must not let consumers paint
        // the just-accepted stroke a different color via
        // setStrokeColor, which would interfere with the strokeColor
        // / showAcceptedStroke contract). Click-to-inspect is only
        // meaningful while the writer is idle.
        if (m.quizActive) {
          return;
        }
        const strokeIndex = getStrokeIndexAtPoint(e.clientX, e.clientY);
        mountOpts.onClick!({ character: currentCharacter, strokeIndex });
      };
      // Attach to layerEl (Char-owned) instead of targetEl so clicks on
      // unrelated sibling DOM the host placed inside targetEl do not
      // trigger spurious onClick callbacks (with strokeIndex: null).
      m.layerEl.addEventListener("click", m.boundOnClick);
    }

    mounted = m;
    return api;
  }

  function unmount(): Char {
    assertNotDestroyed();
    if (!mounted) {
      return api;
    }
    const m = mounted;
    // Tear down any in-flight quiz/animate so hanzi-writer's listeners and
    // overlay state do not stay alive on the about-to-be-detached SVG.
    // Invalidate any queued start()/animate() that is still waiting on
    // configReady so they cannot resurrect after unmount.
    ++requestSeq;
    cancelActiveAnimation(m);
    cancelActiveQuiz(m);
    m.quizArmed = false;
    mounted = null;
    if (m.boundOnClick) {
      m.layerEl.removeEventListener("click", m.boundOnClick);
      m.boundOnClick = null;
    }
    if (m.trailingClickGuard) {
      m.trailingClickGuard();
    }
    // Symmetric with mount(), which only appends layerEl. Removing just
    // layerEl leaves any unrelated DOM the host may already have inside
    // targetEl untouched; gridSvg / activeOverlay are inside layerEl so
    // they're dropped together.
    m.layerEl.remove();
    return api;
  }

  function isMounted(): boolean {
    assertNotDestroyed();
    return mounted !== null;
  }

  // ===== headless config API =====
  function ready(): Promise<void> {
    assertNotDestroyed();
    return configReady;
  }

  function getStrokeEndings(): readonly StrokeEnding[] | null {
    assertNotDestroyed();
    return strokeEndings;
  }
  function getStrokeGroups(): readonly number[][] | null {
    assertNotDestroyed();
    return strokeGroups;
  }
  function setStrokeGroups(next: number[][]): Char {
    assertNotDestroyed();
    strokeGroups = next;
    return api;
  }
  function setStrokeEndings(next: StrokeEnding[]): Char {
    assertNotDestroyed();
    strokeEndings = next;
    return api;
  }

  function getLogicalStrokeCount(): number {
    assertNotDestroyed();
    if (strokeGroups) {
      return strokeGroups.length;
    }
    if (mounted) {
      return getStrokePaths(mounted).length;
    }
    if (checker) {
      return checker.character.strokes.length;
    }
    return 0;
  }

  async function setCharacter(c: string): Promise<Char> {
    assertNotDestroyed();
    currentCharacter = c;
    strokeEndings = null;
    characterData = null;
    if (mounted) {
      mounted.strokeEndingMistakes = 0;
      mounted.pendingEndingCheck = null;
      // Retained ink belongs to the previous character; drop it so the
      // overlay corresponds to whatever is being rendered now.
      clearRetainedStrokes(mounted);
      await mounted.hw.setCharacter(c);
    }
    if (checker) {
      checker.perStroke = [];
      await checker.hw.setCharacter(c);
      checker.character = (checker.hw as unknown as {
        _character: { strokes: Array<{ getAverageDistance(points: Pt[]): number }> };
      })._character;
    }
    return api;
  }

  // ===== mount-bound public API =====
  function start(): Char {
    const m = assertMounted();
    cancelActiveAnimation(m);
    // Starting a new quiz attempt is a clean slate for retained ink —
    // previous attempts' strokes shouldn't pile up on the new one.
    clearRetainedStrokes(m);
    m.quizArmed = true;
    const seq = ++requestSeq;
    configReady.then(() => {
      if (destroyed || mounted !== m || seq !== requestSeq) {
        return;
      }
      startQuiz(m);
    });
    return api;
  }

  function animate(): Char {
    const m = assertMounted();
    cancelActiveQuiz(m);
    const seq = ++requestSeq;
    configReady.then(() => {
      if (destroyed || mounted !== m || seq !== requestSeq) {
        return;
      }
      startAnimation(m);
    });
    return api;
  }

  function reset(): Char {
    const m = assertMounted();
    ++requestSeq;
    cancelActiveAnimation(m);
    cancelActiveQuiz(m);
    clearRetainedStrokes(m);
    m.quizArmed = false;
    resetStrokeColors();
    return api;
  }

  function undo(): Char {
    const m = assertMounted();
    const wasArmed = m.quizArmed;
    ++requestSeq;
    cancelActiveAnimation(m);
    cancelActiveQuiz(m);
    clearRetainedStrokes(m);
    resetStrokeColors();
    if (wasArmed) {
      // quizArmed remains true: the quiz is being re-armed in place.
      const seq = ++requestSeq;
      configReady.then(() => {
        if (destroyed || mounted !== m || seq !== requestSeq) {
          return;
        }
        startQuiz(m);
      });
    }
    return api;
  }

  function hideCharacter(): Char {
    assertMounted().hw.hideCharacter();
    return api;
  }
  function showCharacter(): Char {
    assertMounted().hw.showCharacter();
    return api;
  }
  function showOutline(): Char {
    assertMounted().hw.showOutline();
    return api;
  }
  function hideOutline(): Char {
    assertMounted().hw.hideOutline();
    return api;
  }

  function getStrokeIndexAtPoint(clientX: number, clientY: number): number | null {
    const m = assertMounted();
    const svg = m.hwSvg;
    if (!svg) {
      return null;
    }
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !(el instanceof SVGPathElement)) {
      return null;
    }
    const clipAttr = el.getAttribute("clip-path");
    if (!clipAttr) {
      return null;
    }
    const match = clipAttr.match(/#([^")\s]+)/);
    if (!match) {
      return null;
    }
    const maskId = match[1];

    const clipPaths = svg.querySelectorAll("defs clipPath");
    const strokeCount = getStrokePaths(m).length;
    if (strokeCount === 0) {
      return null;
    }
    for (let i = 0; i < clipPaths.length; i++) {
      if (clipPaths[i].id === maskId) {
        const dataIdx = i % strokeCount;
        return getLogicalStrokeNum(dataIdx);
      }
    }
    return null;
  }

  function setStrokeColor(logicalStrokeNum: number, color: string = "#FF0000"): Char {
    const m = assertMounted();
    const strokePaths = getStrokePaths(m);
    const dataIndices = strokeGroups
      ? strokeGroups[logicalStrokeNum] ?? []
      : [logicalStrokeNum];
    for (const dataIdx of dataIndices) {
      const path = strokePaths[dataIdx];
      if (path) {
        if (path.dataset.kakitoriOriginalStroke === undefined) {
          path.dataset.kakitoriOriginalStroke = path.style.stroke || "";
        }
        path.style.stroke = color;
      }
    }
    return api;
  }

  function resetStrokeColor(logicalStrokeNum: number): Char {
    const m = assertMounted();
    const strokePaths = getStrokePaths(m);
    const dataIndices = strokeGroups
      ? strokeGroups[logicalStrokeNum] ?? []
      : [logicalStrokeNum];
    for (const dataIdx of dataIndices) {
      const path = strokePaths[dataIdx];
      if (path && path.dataset.kakitoriOriginalStroke !== undefined) {
        path.style.stroke = path.dataset.kakitoriOriginalStroke;
        delete path.dataset.kakitoriOriginalStroke;
      }
    }
    return api;
  }

  function resetStrokeColors(): Char {
    const m = assertMounted();
    const strokePaths = getStrokePaths(m);
    for (const path of strokePaths) {
      if (path.dataset.kakitoriOriginalStroke !== undefined) {
        path.style.stroke = path.dataset.kakitoriOriginalStroke;
        delete path.dataset.kakitoriOriginalStroke;
      }
    }
    return api;
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }
    // Reuse unmount() so destroy() inherits its non-destructive teardown
    // (only the layer Char appended is removed; sibling DOM the host had
    // inside targetEl stays in place). Set `destroyed` after so the
    // `assertNotDestroyed` checks inside unmount-adjacent code paths do
    // not throw.
    if (mounted) {
      unmount();
    }
    destroyed = true;
    if (checker) {
      checker.container.remove();
      checker = null;
    }
    // ensureChecker() re-checks `destroyed` after its polling await and
    // rejects if it flipped during init; the catch in that block already
    // removes the offscreen container. Swallow the rejection here so it
    // does not propagate as unhandled when nobody awaited the in-flight
    // checkStroke() call.
    if (checkerInit) {
      checkerInit.catch(() => {});
      checkerInit = null;
    }
    characterData = null;
  }

  // ===== construction =====
  // Auto-load config from @k1low/kakitori-data unless disabled (null).
  const configLoader = options.configLoader === null
    ? null
    : options.configLoader ?? defaultConfigLoader;
  let configReady: Promise<void>;
  if (configLoader) {
    configReady = Promise.resolve()
      .then(() => configLoader(currentCharacter))
      .then((config) => {
        if (destroyed) {
          return;
        }
        if (!config) {
          return;
        }
        log?.(`config loaded: ${JSON.stringify(config)}`);
        if (strokeGroups == null && config.strokeGroups) {
          strokeGroups = config.strokeGroups;
        }
        if (!strokeEndings && config.strokeEndings) {
          strokeEndings = config.strokeEndings ?? null;
        }
      })
      .catch((error) => {
        if (destroyed) {
          return;
        }
        log?.(
          `config load failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  } else {
    configReady = Promise.resolve();
  }

  const api: Char = {
    ready,
    checkStroke,
    check,
    result,
    getStrokeEndings,
    setStrokeEndings,
    getStrokeGroups,
    setStrokeGroups,
    getLogicalStrokeCount,
    setCharacter,
    mount,
    unmount,
    isMounted,
    start,
    animate,
    reset,
    undo,
    hideCharacter,
    showCharacter,
    showOutline,
    hideOutline,
    setStrokeColor,
    resetStrokeColor,
    resetStrokeColors,
    getStrokeIndexAtPoint,
    destroy,
  };
  return api;
}

function renderImpl(
  target: string | HTMLElement,
  character: string,
  options: RenderOptions = {},
): void {
  const el = typeof target === "string"
    ? document.querySelector(target)
    : target;
  if (!el) {
    throw new Error(`char.render(): target selector "${target}" did not match any element.`);
  }
  const size = options.size ?? DEFAULT_SIZE;
  const padding = options.padding ?? DEFAULT_PADDING;
  validateSizeAndPadding(size, padding, "char.render()");
  const loader = options.charDataLoader ?? defaultCharDataLoader;

  loader(
    character,
    (data) => {
      const strokeColor = options.strokeColor ?? "#555";

      const scale = (size - 2 * padding) / HANZI_PRESCALED_SIZE;

      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));

      if (options.showGrid) {
        drawCrossGrid(svg, size, options.showGrid);
      }

      // Translate so that hanzi-writer's character bounds (y ∈ [-124, 900])
      // span the inner box: y=-124 (descender bottom) lands at
      // (size - padding), y=900 (top) lands at padding. Shift the y origin
      // by HANZI_Y_BASELINE_OFFSET * scale to make room for the descender.
      const g = document.createElementNS(ns, "g");
      g.setAttribute(
        "transform",
        `translate(${padding}, ${size - padding - HANZI_Y_BASELINE_OFFSET * scale}) scale(${scale}, ${-scale})`,
      );

      for (const d of data.strokes) {
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", strokeColor);
        g.appendChild(path);
      }

      svg.appendChild(g);

      el.appendChild(svg);

      if (options.onClick) {
        svg.style.cursor = "pointer";
        svg.addEventListener("click", () => {
          options.onClick!({ character });
        });
      }
    },
    (err) => { console.error(`char.render(): failed to load "${character}"`, err); },
  );
}

export const char = {
  /**
   * Create a new Char instance for `character`. Headless by default — call
   * {@link Char.mount} to attach it to a DOM element for interactive
   * practice. {@link Char.checkStroke} works without mounting.
   * @example
   * const c = char.create("永");
   * c.mount("#target", { size: 300 });
   * c.start();
   */
  create: createImpl,
  /**
   * Render a character as a lightweight static SVG without HanziWriter.
   * @example
   * char.render("#target", "永", { size: 60, onClick: ({ character }) => console.log(character) });
   */
  render: renderImpl,
};
