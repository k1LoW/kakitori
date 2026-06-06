import type {
  CharCreateOptions,
  CharDataLoaderFn,
  CharResult,
  ConfigLoaderFn,
  MountOptions,
} from "../charOptions.js";
import type { WritingMode } from "./block.js";
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
 * Result of a single cell. Same shape regardless of cell kind:
 * - guided cells produce exactly one `CharResult` (the cell's character);
 * - free cells produce one per character in the matched candidate;
 * - blank cells produce zero (visual-only chrome).
 */
export interface BlockCellResult {
  /** Mirrors the cell's spec kind. Determines the shape of `chars`. */
  kind: "guided" | "free" | "blank";
  /**
   * Per-character results. Length depends on `kind`: guided=1,
   * free=expected length (one entry per character in the matched
   * candidate), blank=0.
   */
  chars: CharResult[];
  /**
   * Display-slot span this cell occupied in the original block
   * layout, in `cellSize` units. Populated when the spec explicitly
   * set `span` (free / blank cells with a width wider than the
   * matched candidate / default 1); omitted when the spec relied on
   * the default span. `block.restore` / `page.restore` honour this
   * to preserve the original layout; the live `Block` runtime
   * ignores it (it reads the span straight from the spec).
   */
  span?: number;
}

/** Result of a furigana annotation. One `CharResult` per character in the candidate. */
export interface BlockAnnotationResult {
  /**
   * Per-character results in the annotation. Length equals the
   * expected text length; entries the matcher hasn't locked in yet
   * stay `complete: false` placeholders.
   */
  chars: CharResult[];
}

/**
 * Result of a block — a composite of every cell + annotation it owns.
 * Returned by {@link Block.result} at any time and also passed verbatim
 * to `onBlockComplete` (where `complete` is always `true`). Pair
 * `complete` with `matched` to distinguish "still in progress" / "done
 * and correct" / "done with failures".
 */
export interface BlockResult {
  /**
   * Identifier echoed from the wrapping `PageBlockEntry.id` when the
   * block was placed via {@link page.create}. Standalone
   * {@link block.create} returns a BlockResult with `id` undefined.
   * Use this for stable correlation across `PageResult.blocks` /
   * `onBlockComplete` callbacks instead of relying on array index.
   */
  id?: string;
  /** Every cell + annotation has reported a complete `CharResult`. */
  complete: boolean;
  /**
   * Every **completed** character (`CharResult.complete === true`)
   * matched. In-progress chars are excluded from this rollup, so
   * `matched: true` with `complete: false` means "no failures yet"
   * rather than "all characters matched". Vacuously `true` until the
   * first character settles.
   */
  matched: boolean;
  /** Per-cell results in `BlockSpec.cells` order. */
  cells: BlockCellResult[];
  /** Per-annotation results in `BlockSpec.annotations` order. */
  annotations: BlockAnnotationResult[];
}

/** Loaders shared across all child Char instances inside a Block. */
export interface BlockLoaders {
  charDataLoader?: CharDataLoaderFn;
  /** Pass `null` to disable auto-loading of strokeEndings / strokeGroups. */
  configLoader?: ConfigLoaderFn | null;
}

/**
 * Options for `block.restore`, the static result renderer for a
 * {@link BlockResult}. Mirrors `block.create`'s layout vocabulary
 * (`cellSize`, `writingMode`) plus the per-char visual knobs forwarded
 * to {@link RestoreOptions}. Annotations are not rendered in v1
 * because `BlockAnnotationResult` does not carry layout (`cellRange`
 * etc.); only cell content is drawn.
 */
export interface BlockRestoreOptions {
  /** Per-cell side length in display pixels. Required. */
  cellSize: number;
  /** Layout direction. Defaults to `"vertical-rl"`. */
  writingMode?: WritingMode;
  /** Per-cell padding inside the cell box. Defaults to 0. */
  padding?: number;
  /** Cell border width in display pixels. Defaults to 1. */
  cellBorderWidth?: number;
  /** Cell border color. Defaults to `"#ddd"`, matching `block.create`. */
  cellBorderColor?: string;
  // Visual options forwarded to char.restore for every char slot.
  drawingWidth?: number;
  drawingColor?: string;
  showGrid?: import("../charOptions.js").RestoreOptions["showGrid"];
  showCharacter?: boolean;
  showOutline?: boolean;
  strokeColor?: string;
  outlineColor?: string;
  okColor?: string;
  ngColor?: string;
  charDataLoader?: CharDataLoaderFn;
}
