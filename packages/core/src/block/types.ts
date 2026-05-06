import type {
  CharCreateOptions,
  CharDataLoaderFn,
  CharJudgeResult,
  ConfigLoaderFn,
  MountOptions,
} from "../charOptions.js";
import type { TimedPoint } from "../types.js";

/** Single string or list of acceptable answers for a free cell or annotation. */
export type Expected = string | string[];

/** When a stroke / cell / block is rejected, what should be reset. */
export type RollbackScope = "stroke" | "character" | "block";

/** A cell where the user is shown a character template (Char) and traces it. */
export interface GuidedCell {
  kind: "guided";
  char: string;
  /** `'show'` displays the character; `'write'` runs a quiz. */
  mode: "write" | "show";
  /**
   * Per-cell overrides for the underlying Char. Splits internally into
   * create-time vs mount-time options.
   */
  overrides?: Partial<CharCreateOptions> & Partial<MountOptions>;
}

/** A free-form area where the user writes any of the accepted strings. */
export interface FreeCell {
  kind: "free";
  expected: Expected;
  mode: "write" | "show";
  /**
   * How many grid slots the cell occupies. Defaults to the longest accepted
   * string's length, so the visible width hints the answer length. Set to a
   * larger value (e.g. for tests where you want to hide the answer length)
   * to reserve more space.
   * Constraint: `span >= max(expected.length)`.
   */
  span?: number;
  similarityThreshold?: number;
}

export type Cell = GuidedCell | FreeCell;

/** Furigana (or any text annotation) attached to a cell range in the block. */
export interface FuriganaAnnotation {
  /** Closed range of cell indices the annotation covers. */
  cellRange: [number, number];
  expected: Expected;
  mode: "write" | "show";
  /** Defaults to `'right'` for vertical-rl, `'top'` for horizontal-tb. */
  placement?: "top" | "bottom" | "left" | "right";
  /** Annotation size relative to the covered cells (longer side ratio). */
  sizeRatio?: number;
  similarityThreshold?: number;
}

export interface BlockSpec {
  id?: string;
  cells: Cell[];
  annotations?: FuriganaAnnotation[];
  rollback?: RollbackScope;
  /** Per-cell side length in pixels. Defaults to the parent grid's cell size. */
  size?: number;
  startLine?: number;
  startCellInLine?: number;
  break?: "before" | "after";
  gap?: number;
  label?: string;
}

export interface BlockOptions {
  rollback?: RollbackScope;
  size?: number;
  /** Order of guided cell vs its annotation when both are writable. */
  annotationOrder?: "cell-first" | "annotation-first";
}

/** Per-stroke event surfaced by free cells (mirrors mount's CharStrokeData). */
export interface FreeCellStrokeEvent {
  /** Stroke order index within this cell (0-based). */
  strokeNum: number;
  /** Captured points in cell-local pixels with timestamps (release sample appended). */
  points: TimedPoint[];
}

/** Result for a `'guided'` cell. */
export interface GuidedCellResult {
  kind: "guided";
  matched: boolean;
  /** Mistakes reported by hanzi-writer's quiz path (only when `mode === 'write'`). */
  mistakes: number;
  /** Mistakes flagged by tome / hane / harai judgment. */
  strokeEndingMistakes: number;
}

/** Result for a `'free'` cell or a furigana annotation. */
export interface FreeCellResult {
  kind: "free";
  matched: boolean;
  /** The expected candidate that matched, or the closest one when no candidate matched. */
  candidate: string | null;
  similarity: number;
  /** Per-character judgement of the candidate (length === Array.from(candidate).length). */
  perCharacter: CharJudgeResult[];
}

export type CellResult = GuidedCellResult | FreeCellResult;

export type AnnotationResult = FreeCellResult;

export interface BlockResult {
  matched: boolean;
  perCell: CellResult[];
  perAnnotation: AnnotationResult[];
}

/** Loaders shared across all child Char instances inside a Block. */
export interface BlockLoaders {
  charDataLoader?: CharDataLoaderFn;
  /** Pass `null` to disable auto-loading of strokeEndings / strokeGroups. */
  configLoader?: ConfigLoaderFn | null;
}
