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
 * that judge / quiz / animate share.
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
   * Granularity at which user input is judged. Default `"per-stroke"`.
   *
   * - `"per-stroke"`: hanzi-writer's quiz drives matching. Each stroke
   *   is judged the moment the user lifts the pointer, mistakes are
   *   rejected, and `onMistake` fires per attempt.
   * - `"per-char"`: hanzi-writer's quiz is bypassed. The user freely
   *   draws every stroke without per-stroke rejection. Once the user
   *   has completed as many pointerdown→up cycles as the character
   *   has logical strokes, kakitori judges each captured stroke and
   *   fires `onCorrectStroke` (with `matched` reflecting the verdict)
   *   plus a single `onComplete`. `mistakesOnStroke` is always `0`
   *   in this mode (there is no guided-write attempt count).
   */
  evaluation?: "per-stroke" | "per-char";
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
  }) => void;
  onClick?: (data: {
    character: string;
    strokeIndex: number | null;
  }) => void;
}

/**
 * Per-call options for {@link Char.judge}.
 */
export interface CharJudgeStrokeOptions {
  /**
   * Source coordinate-space square. When provided, judge() linearly maps
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
 * headless judge ({@link Char.judge}) and the mounted quiz
 * ({@link Char.start}) paths — a stroke result is a stroke result.
 */
export interface CharStrokeResult {
  /**
   * Whether this stroke was accepted by the matcher. Placeholder
   * entries (filling gaps from out-of-order judge calls) come back
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
   * Tome / hane / harai judgment for this stroke. Present only when an
   * ending was actually evaluated — i.e. on guided write strokes that
   * had an expected ending registered, or on headless `Char.judge`
   * calls that requested ending evaluation. Undefined otherwise.
   */
  strokeEnding?: StrokeEndingResult;
  /**
   * Raw drawn samples for this stroke, with timestamps. Suitable as
   * the second argument to {@link Char.judge} for replay / re-judging.
   *
   * **Coordinate space depends on the path that produced the result:**
   *
   * - **Mounted quiz** (`onCorrectStroke` / `onMistake`): hanzi-writer
   *   internal coords (Y-up, `x ∈ [0, HANZI_PRESCALED_SIZE]`,
   *   `y ∈ [HANZI_Y_MIN, HANZI_Y_MAX]`). The capture pipeline projects
   *   the user's client-space pointer events into this space before
   *   storing them. Replay via `Char.judge` should omit `opts.sourceBox`.
   * - **Headless `Char.judge`**: exactly the points the caller passed
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
   * the headless judge path and on synthetic show-mode strokes.
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
 * judger or the mounted quiz, with `mistakes` / `strokeEndingMistakes`
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
   * Every **observed** stroke matched. Out-of-order judge() calls that
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
   * headless judger has always returned).
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
