import type { CharStrokeData, StrokeEndingResult, TimedPoint } from "./types.js";
import type { CharacterConfig } from "./dataLoader.js";

export type CharLogger = (msg: string) => void;
export type ConfigLoaderFn = (char: string) => Promise<CharacterConfig | null>;

export type CharDataLoaderFn = (
  char: string,
  onLoad: (data: { strokes: string[]; medians: number[][][] }) => void,
  onError: (err?: unknown) => void,
) => void;

export interface GridOptions {
  color?: string;
  dashArray?: string;
  width?: number;
}

/** Options for {@link char.render}, the static SVG renderer. */
export interface RenderOptions {
  size?: number;
  padding?: number;
  strokeColor?: string;
  showGrid?: boolean | GridOptions;
  charDataLoader?: CharDataLoaderFn;
  onClick?: (data: { character: string }) => void;
}

/**
 * Options that apply to a Char instance regardless of whether it is mounted
 * to the DOM. Cover headless judging and the character-level configuration
 * that check / quiz / animate share.
 */
export interface CharCreateOptions {
  logger?: CharLogger;
  /** Custom config loader. Defaults to loading from unpkg @k1low/kakitori-data. Set to null to disable auto-loading. */
  configLoader?: ConfigLoaderFn | null;
  /** Custom hanzi-writer character-data loader (defaults to unpkg). */
  charDataLoader?: CharDataLoaderFn;
  /** Maps logical strokes to data stroke indices. Overrides config from configLoader. */
  strokeGroups?: number[][];
  /** Stroke matcher leniency (passed through to hanzi-writer). */
  leniency?: number;
  /** Stroke ending strictness in [0, 1]. Default 0.7. */
  strokeEndingStrictness?: number;
}

/**
 * Options that apply once the Char is mounted to the DOM via
 * {@link Char.mount}. Drawing colors, grid, animation timing, quiz callbacks,
 * etc. — anything that has no meaning for a headless judging instance.
 */
export interface MountOptions {
  // Geometry
  size?: number;
  padding?: number;
  // Colors
  strokeColor?: string;
  outlineColor?: string;
  drawingColor?: string;
  drawingWidth?: number;
  highlightColor?: string;
  // Grid / character visibility
  showGrid?: boolean | GridOptions;
  showOutline?: boolean;
  showCharacter?: boolean;
  /**
   * Keep each user-drawn stroke visible after it is accepted, so the
   * cell builds up the actual ink the user wrote (practice-paper feel)
   * instead of hanzi-writer's default behavior of fading the drawing
   * out. Strokes are rendered as raw polylines in layer-relative display
   * coords; they're cleared on `reset()` / `start()` / `undo()` and on
   * unmount. Default: `false`.
   */
  retainStrokes?: boolean;
  /** Color used for retained strokes. Defaults to `drawingColor`. */
  retainedStrokeColor?: string;
  /**
   * Stroke width (display pixels) used for retained strokes. Defaults
   * to the on-screen thickness of hanzi-writer's pen, i.e.
   * `drawingWidth * innerSize / HANZI_PRESCALED_SIZE`.
   */
  retainedStrokeWidth?: number;
  /**
   * Whether to paint hanzi-writer's official stroke once a stroke is
   * accepted. Default: `true` (the usual quiz behavior: the gray
   * reference stroke replaces the user's drawing).
   *
   * Set to `false` for a "paper-only" feel — combined with
   * `retainStrokes: true`, only the user's own ink stays visible. The
   * outline (`showOutline`) and character template (`showCharacter`)
   * are unaffected.
   *
   * Internally this overrides hanzi-writer's `strokeColor` to a fully
   * transparent rgba. If the caller explicitly sets `strokeColor`,
   * that value wins (so an explicit color is never silently hidden).
   */
  showAcceptedStroke?: boolean;
  /**
   * Granularity at which user input is corrected. Default
   * `"per-stroke"`.
   *
   * - `"per-stroke"`: hanzi-writer's quiz drives matching. Each stroke
   *   is corrected the moment the user lifts the pointer, mistakes
   *   are rejected, and `onMistake` fires per attempt.
   * - `"per-char"`: hanzi-writer's quiz is bypassed. The user freely
   *   draws every stroke without per-stroke rejection. Once the user
   *   has completed as many pointerdown→up cycles as the character has
   *   logical strokes, kakitori corrects each captured stroke. Per
   *   stroke verdicts dispatch through the existing callbacks —
   *   matched strokes fire `onCorrectStroke`, unmatched ones fire
   *   `onMistake` — followed by a single `onComplete`.
   *   `mistakesOnStroke` is always `0` in this mode (no guided-write
   *   retry count).
   *
   *   Per-char skips hanzi-writer's live-ink rendering, so kakitori
   *   paints each drawn stroke as a polyline regardless of
   *   {@link MountOptions.retainStrokes} — there is no per-stroke
   *   accept moment to draw the official stroke instead. After
   *   correction, `retainStrokes` decides whether those polylines
   *   stay on screen (`true`) or are cleared (`false`, the default).
   * - `"deferred"`: same capture flow as `"per-char"` (no per-stroke
   *   rejection, live-ink polylines as the user drags) BUT correction
   *   does not run automatically once all strokes are captured.
   *   Instead, `onCharCaptured` fires with the buffered captures and
   *   kakitori waits for an external trigger via {@link Char.check}
   *   to run correction. Used by higher-level orchestrators (block
   *   per-block, page per-page) to hold off cell-by-cell verdicts
   *   until the surrounding group is fully drawn.
   */
  correction?: "per-stroke" | "per-char" | "deferred";
  /**
   * Fires when {@link correction} is `"deferred"` and the user has
   * drawn enough pointer cycles to match the character's logical
   * stroke count. `captures` is the buffered per-stroke point arrays
   * in draw order, exposed for inspection only — kakitori retains
   * the same buffer internally. Call {@link Char.check} (no args)
   * whenever you're ready to run correction; it consumes the
   * internal buffer.
   */
  onCharCaptured?: (
    captures: ReadonlyArray<ReadonlyArray<TimedPoint>>,
  ) => void;
  /**
   * Cap on how many in-place retries the char will accept on NG
   * verdicts under `correction: "per-char"` / `"deferred"` before
   * giving up and firing {@link onComplete} with the accumulated
   * mistake counters. Semantics:
   *
   * - `undefined` (default): unlimited retries — the char keeps
   *   re-arming until the user lands an OK attempt.
   * - `0`: no retries — the first NG attempt commits as failed
   *   (`onComplete` fires immediately, `onCharRejected` never
   *   fires).
   * - `N`: up to `N` retries allowed; the `(N + 1)`-th NG attempt
   *   commits as failed.
   *
   * Mistake counters (`totalMistakes`, `strokeEndingMistakes`)
   * accumulate across every attempt, so the final `onComplete`
   * carries the cumulative count. The per-stroke verdicts in
   * {@link Char.result} are NOT cumulative — each retry wipes the
   * previous attempt's verdicts so the final verdict array
   * reflects only the attempt that ultimately settled (OK on a
   * successful retry, or the final NG on an exhausted budget).
   * This keeps `perStroke` aligned with the displayed ink: a
   * half-good prior attempt won't leave stale OK strokes hanging
   * around in the result.
   */
  maxRetries?: number;
  /**
   * Fires every time the char wipes itself for an NG retry. Surfaces
   * the rejection from both retry paths:
   *
   * 1. `correction: "per-char"`: a finalize attempt landed NG, the
   *    retained ink was wiped, and the capture buffer was reset for
   *    a fresh attempt.
   * 2. `correction: "deferred"`: a {@link Char.check} call from a
   *    higher-level coordinator (block / page) landed NG; same wipe
   *    + per-char cycle re-arm as path 1, plus the rejection is
   *    propagated up so the coordinator can reverse its "captured"
   *    pending bookkeeping.
   *
   * `data` mirrors the shape passed to {@link onComplete} so a host
   * showing retry feedback can read the same counters: `totalMistakes`
   * and `strokeEndingMistakes` accumulate across every NG attempt
   * (matching per-stroke's `totalMistakes` rollup). `onComplete` is
   * held back until a future attempt lands OK.
   */
  onCharRejected?: (data: {
    character: string;
    totalMistakes: number;
    strokeEndingMistakes: number;
    /** 1-indexed attempt count — `1` after the first NG, `2` after the second, etc. */
    attempts: number;
  }) => void;
  // Animation
  strokeAnimationSpeed?: number;
  delayBetweenStrokes?: number;
  // Quiz
  showHintAfterMisses?: number | false;
  highlightOnComplete?: boolean;
  /**
   * When true, a stroke whose ending (tome/hane/harai) does not match the
   * expected types is rejected as a miss: the stroke is not advanced and the
   * user must redraw it. `onStrokeEndingMistake` and `onMistake` both fire.
   * Default: false.
   */
  strokeEndingAsMiss?: boolean;
  // Callbacks (interactive only)
  onCorrectStroke?: (data: CharStrokeData) => void;
  onStrokeEndingMistake?: (data: CharStrokeData) => void;
  onMistake?: (data: CharStrokeData) => void;
  onComplete?: (data: {
    character: string;
    totalMistakes: number;
    strokeEndingMistakes: number;
    /**
     * Whether the final attempt matched. Always `true` under
     * `correction: "per-stroke"` (the user retries forever until the
     * matcher accepts), and under `correction: "per-char"` /
     * `"deferred"` when `maxRetries` is `undefined` (unlimited
     * retries). Can be `false` when `maxRetries` is finite and the
     * user exhausted every allowed retry without landing OK.
     */
    matched: boolean;
    /** 1-indexed attempt count of the final attempt that triggered completion. */
    attempts: number;
  }) => void;
  onClick?: (data: {
    character: string;
    strokeIndex: number | null;
  }) => void;
}

/**
 * Per-call options for {@link Char.checkStroke}.
 */
export interface CharCheckStrokeOptions {
  /**
   * Source coordinate-space square. When provided, check() linearly maps
   * each source axis into hanzi-writer's internal coords:
   *
   *   x: `[sourceBox.x, sourceBox.x + size]` → `[0, HANZI_PRESCALED_SIZE]`
   *   y: `[sourceBox.y, sourceBox.y + size]` → `[HANZI_Y_MAX, HANZI_Y_MIN]`
   *
   * The Y axis flips (source is Y-down / browser convention; hanzi-writer
   * is Y-up) and lands in the asymmetric `[HANZI_Y_MIN, HANZI_Y_MAX]`
   * range — `sourceBox.y` (source top) → `HANZI_Y_MAX`, and
   * `sourceBox.y + size` (source bottom) → `HANZI_Y_MIN`, NOT 0.
   *
   * Pass the SAME `sourceBox` for every stroke of a single character so
   * the spatial relationship across strokes is preserved.
   *
   * If your input strokes are not square-fit, expand to a square (using the
   * longer side of the bounding box) before passing the box here so the
   * aspect ratio is preserved.
   *
   * Omit when `points` are already in hanzi-writer internal coords.
   */
  sourceBox?: { x: number; y: number; size: number };
}

/**
 * Per-stroke result, indexed by logical stroke number in
 * {@link CharResult.perStroke}. The same shape is used for both the
 * headless check ({@link Char.checkStroke}) and the mounted quiz
 * ({@link Char.start}) paths — a stroke result is a stroke result.
 */
export interface CharStrokeResult {
  /**
   * Whether this stroke was accepted by the matcher. Placeholder
   * entries (filling gaps from out-of-order check calls) come back
   * `false`.
   */
  matched: boolean;
  /**
   * Match score in `[0, 1]`, derived from hanzi-writer's per-stroke
   * average distance against the reference path. `0` for placeholder
   * gap entries.
   */
  similarity: number;
  /**
   * Tome / hane / harai check for this stroke. Present only when an
   * ending was actually evaluated — i.e. on guided write strokes that
   * had an expected ending registered, or on headless `Char.checkStroke`
   * calls that requested ending evaluation. Undefined otherwise.
   */
  strokeEnding?: StrokeEndingResult;
  /**
   * Raw drawn samples for this stroke, with timestamps. Suitable as
   * the second argument to {@link Char.checkStroke} for replay / re-judging.
   *
   * **Coordinate space depends on the path that produced the result:**
   *
   * - **Mounted quiz** (`onCorrectStroke` / `onMistake`): hanzi-writer
   *   internal coords (Y-up, `x ∈ [0, HANZI_PRESCALED_SIZE]`,
   *   `y ∈ [HANZI_Y_MIN, HANZI_Y_MAX]`). The capture pipeline projects
   *   the user's client-space pointer events into this space before
   *   storing them. Replay via `Char.checkStroke` should omit `opts.sourceBox`.
   * - **Headless `Char.checkStroke`**: exactly the points the caller passed
   *   in. If the caller used `opts.sourceBox`, those are in the
   *   caller's source space (Y-down browser convention); without
   *   `sourceBox`, they are already in hanzi-writer internal coords.
   *   Re-pass the same `sourceBox` (or none) to replay verbatim.
   *
   * Undefined for synthetic show-mode strokes (no user input) and for
   * placeholder gap entries.
   */
  points?: TimedPoint[];
  /**
   * Guided write only: how many misses occurred on this stroke before
   * the matcher accepted it. `0` for first-try success. Undefined on
   * the headless check path and on synthetic show-mode strokes.
   */
  mistakesOnStroke?: number;
  /**
   * Guided write only: hanzi-writer's reverse-stroke detection (the
   * user drew the stroke in the wrong direction). Undefined elsewhere.
   */
  isBackwards?: boolean;
}

/**
 * Snapshot of a single character's writing progress — the leaf type for
 * results across the whole stack. {@link Char.result} returns one of
 * these; free cells / annotations expose `CharResult[]` (one per
 * expected character); blocks / pages aggregate them in their snapshot
 * trees.
 *
 * Same shape regardless of whether the data came from the headless
 * checker or the mounted quiz, with `mistakes` / `strokeEndingMistakes`
 * populated only on the guided (mount + quiz) path and `similarity` /
 * `candidate` populated only inside a free cell or annotation.
 */
export interface CharResult {
  /** Which character was written (e.g. "学", "が"). */
  character: string;
  /**
   * Every logical stroke for this character has been observed. For
   * guided cells this means the quiz fired its completion; for free
   * cells it means a candidate match locked this character in.
   */
  complete: boolean;
  /**
   * Every **observed** stroke matched. Out-of-order check() calls that
   * leave gaps don't drag this rollup to `false` — only real per-stroke
   * results count. Vacuously `true` before any stroke has been observed.
   * Pair with `complete` to distinguish "still in progress" / "done and
   * correct" / "done with failures".
   */
  matched: boolean;
  /**
   * Per-logical-stroke history. Length equals the highest observed
   * stroke index + 1; gaps are filled with placeholder
   * `{ matched: false, similarity: 0 }` entries (mirrors the shape the
   * headless checker has always returned).
   */
  perStroke: CharStrokeResult[];
  /** Guided-only: cumulative mistakes from hanzi-writer's quiz. */
  mistakes?: number;
  /** Guided-only: tome / hane / harai mistakes accumulated so far. */
  strokeEndingMistakes?: number;
  /**
   * Free / annotation only: per-character similarity inside the
   * candidate the matcher locked onto. Undefined while the freeCell is
   * still searching.
   */
  similarity?: number;
  /**
   * Free / annotation only: which candidate text this character belongs
   * to (e.g. `"がっこう"`). Undefined while the freeCell is still
   * searching.
   */
  candidate?: string;
  /**
   * Which cell flavour produced this result when it came through a
   * Block / Page result tree. Undefined for {@link Char.result} called
   * standalone (no enclosing cell context).
   */
  source?: "guided" | "free" | "annotation";
  /**
   * Whether this character was expected to be **written** (real
   * practice input) or **shown** (display only, no user input). Set
   * on every result that came through a Block / Page result tree.
   * Undefined for {@link Char.result} called standalone.
   *
   * - `mode === "write"` + `complete === false`: in progress.
   * - `mode === "write"` + `complete === true`: user finished writing.
   * - `mode === "show"` + `complete === true`: display-only, no input
   *   (`perStroke` is always empty).
   */
  mode?: "write" | "show";
}
