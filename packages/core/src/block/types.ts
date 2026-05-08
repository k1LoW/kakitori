import type {
  CharCreateOptions,
  CharDataLoaderFn,
  CharResult,
  ConfigLoaderFn,
  MountOptions,
} from "../charOptions.js";
/** Single string or list of acceptable answers for a free cell or annotation. */
export type Expected = string | string[];

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
}

/**
 * A cell that just draws the empty 練習帳-style chrome (border + cross-grid)
 * with no interactive surface and no answer. Use it (in either a direct
 * `block.create` spec or a block placed on a `page`) to reserve a visual
 * slot that doesn't participate in matching. Nothing fills empty slots
 * automatically — `page.create` renders only the user-supplied blocks,
 * so callers who want chrome in those gaps must place blank-cell blocks
 * explicitly.
 */
export interface BlankCell {
  kind: "blank";
  /** How many grid slots the cell occupies. Defaults to 1. */
  span?: number;
}

export type Cell = GuidedCell | FreeCell | BlankCell;

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
}

export interface BlockSpec {
  cells: Cell[];
  annotations?: FuriganaAnnotation[];
  /** Per-cell side length in pixels. Defaults to the parent grid's cell size. */
  size?: number;
}

/**
 * Snapshot of a cell's progress. Same shape regardless of cell kind:
 * - guided cells produce exactly one `CharResult` (the cell's character);
 * - free cells produce one per character in the matched candidate;
 * - blank cells produce zero (visual-only chrome).
 */
export interface BlockCellSnapshot {
  kind: "guided" | "free" | "blank";
  chars: CharResult[];
}

/** Snapshot of a furigana annotation's progress. One `CharResult` per character in the candidate. */
export interface BlockAnnotationSnapshot {
  chars: CharResult[];
}

/**
 * Snapshot of a block's full progress. Returned by {@link Block.results}
 * at any time and also passed verbatim to `onBlockComplete` (where
 * `complete` is always `true`). Pair `complete` with `matched` to
 * distinguish "still in progress" / "done and correct" / "done with
 * failures".
 */
export interface BlockSnapshot {
  /** Every cell + annotation has reported a complete `CharResult`. */
  complete: boolean;
  /** Every observed character matched (vacuous true before the first stroke). */
  matched: boolean;
  cells: BlockCellSnapshot[];
  annotations: BlockAnnotationSnapshot[];
}

/** Loaders shared across all child Char instances inside a Block. */
export interface BlockLoaders {
  charDataLoader?: CharDataLoaderFn;
  /** Pass `null` to disable auto-loading of strokeEndings / strokeGroups. */
  configLoader?: ConfigLoaderFn | null;
}
