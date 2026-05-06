import type { CharStrokeData, StrokeEnding, StrokeEndingJudgment } from "./types.js";
import type { CharacterConfig } from "./dataLoader.js";
import type { StrokeTimingData } from "./StrokeEndingJudge.js";
import type { Pt } from "./hanziWriterInternals.js";

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
   * `[x, x+size] x [y, y+size]` in source coords to `[0, HANZI_COORD_SIZE]`
   * in hanzi-writer's internal coords, also flipping the Y axis (source is
   * assumed to be Y-down / browser convention; hanzi-writer is Y-up).
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
  /** Pass timing to enable tome/hane/harai judgment for the current stroke. */
  timing?: StrokeTimingData;
}

/**
 * Per-stroke result from {@link Char.judge}. Indexed by logical stroke
 * number in {@link CharJudgeResult.perStroke}.
 */
export interface CharJudgeStrokeResult {
  matched: boolean;
  similarity: number;
  strokeEnding?: StrokeEndingJudgment;
}

/**
 * Cumulative judge result returned by {@link Char.result}. `matched` is
 * true when every stroke that has been judged so far matched.
 */
export interface CharJudgeResult {
  matched: boolean;
  perStroke: CharJudgeStrokeResult[];
}

// Re-export StrokeEnding so callers can construct judge inputs without
// reaching into types.ts directly.
export type { StrokeEnding };
// Re-export Pt so consumers can describe drawn-stroke arguments.
export type { Pt };
