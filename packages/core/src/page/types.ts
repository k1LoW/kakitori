import type {
  AnnotationResult,
  BlockLoaders,
  BlockResult,
  BlockSpec,
  CellResult,
  FreeCellLogger,
  WritingMode,
} from "../block/index.js";
import type { GridOptions } from "../charOptions.js";

/** A block plus an optional identifier echoed back through {@link PageResult}. */
export interface PageBlockEntry {
  spec: BlockSpec;
  /**
   * Optional identifier surfaced as `PageResult.perBlock[i].id` so callers
   * can correlate aggregated results with their original input without
   * indexing into the blocks array. Not passed through `onCellComplete` /
   * `onBlockComplete`, which only receive `blockIndex`.
   */
  id?: string;
}

export interface PageCreateOptions {
  /**
   * Number of columns (vertical-rl) or rows (horizontal-tb) in the page.
   * Together with `cellsPerColumn` this fixes the page dimensions in cells —
   * blocks that don't fit produce an error rather than expanding the page.
   */
  columns: number;
  /** Cells per column (vertical-rl) or per row (horizontal-tb). */
  cellsPerColumn: number;
  /** Per-cell side length in display pixels. */
  cellSize: number;
  /** Layout direction. Defaults to `'vertical-rl'` (Japanese practice book convention). */
  writingMode?: WritingMode;
  /**
   * Page-wide on/off switch for the furigana strip alongside the cells
   * that the user-supplied blocks render. Defaults to `true`: every
   * rendered cell-slot (across all blocks placed on the page) gets a
   * paired strip frame, regardless of whether any block places
   * annotation content there. Empty grid slots between blocks stay
   * blank either way (page draws no chrome of its own). Set to `false`
   * to remove the strip from every rendered cell at once.
   */
  showAnnotationStrip?: boolean;
  /**
   * Width (vertical-rl) / height (horizontal-tb) reserved per column for
   * annotations (ふりがな等). When omitted (and `showAnnotationStrip`
   * is left at the default), the page falls back to
   * `max(largest block annotation thickness, DEFAULT cell ratio)` so
   * even an annotation-free page still shows the strip.
   */
  annotationStripThickness?: number;
  /**
   * Forwarded to every per-segment `block.create()` call: controls the
   * cross-grid drawn inside guided cells (and the matching dashed cross
   * on blank cells). The page itself doesn't paint a separate grid
   * background. `true` uses the cell-border style; `false` disables the
   * cross-grid; an object overrides color / width / dashArray.
   */
  showGrid?: boolean | GridOptions;
  /** Loaders shared by every Char inside every block. */
  loaders?: BlockLoaders;
  /** Free-cell drawing customization forwarded to every block. */
  drawingColor?: string;
  matchedColor?: string;
  failedColor?: string;
  drawingWidth?: number;
  annotationDrawingWidth?: number;
  cellBorderWidth?: number;
  cellBorderColor?: string;
  freeCellLeniency?: number;
  /** Verbose lifecycle / matching trace shared by every block's free cells. */
  logger?: FreeCellLogger;
  /** Debug overlay forwarded to every block's free cells / annotations. */
  showSegmentBoxes?: boolean;
  segmentBoxColor?: string;
  blocks: ReadonlyArray<PageBlockEntry>;
  /**
   * Fired for every cell or annotation completion within any block.
   *
   * `index` is the cell index in `blocks[blockIndex].spec.cells` when
   * `kind === "cell"`, and the annotation index in
   * `blocks[blockIndex].spec.annotations` when `kind === "annotation"`.
   */
  onCellComplete?: (
    blockIndex: number,
    index: number,
    kind: "cell" | "annotation",
    result: CellResult | AnnotationResult,
  ) => void;
  /** Fired once a block has all its results in. */
  onBlockComplete?: (blockIndex: number, result: BlockResult) => void;
  /** Fired once every block has completed. */
  onPageComplete?: (result: PageResult) => void;
}

export interface Page {
  /** Underlying container element (the page wrapper appended to `target`). */
  el: HTMLElement;
  /** Reset every block to a clean writing state. */
  reset(): void;
  /**
   * Cell-level undo at the page level. Walks down to the most recently
   * active block (or page-level annotation) and reverts just that
   * unit. Repeated calls keep walking back through prior activity in
   * LRU-on-touch order — same block's earlier cells first, then the
   * next-most-recent block, and so on. Returns a descriptor of what
   * was undone so the host can surface the action; returns `null` when
   * nothing is left to undo.
   */
  undo(): PageUndoResult | null;
  /** Destroy every child block and detach the page. */
  destroy(): void;
}

/**
 * Descriptor returned from {@link Page.undo}. `block-cell` resolves to
 * the user-block's original cell index (page handles the segment-back-
 * mapping internally); `annotation` resolves to the page-level
 * annotation index inside the same user-block. Mirrors the shape of
 * the {@link import("../block/index.js").Block.undo} return value so
 * hosts can treat the two layers uniformly.
 */
export type PageUndoResult =
  | { kind: "block-cell"; blockIndex: number; cellIndex: number }
  | { kind: "annotation"; blockIndex: number; annotationIndex: number };

/** Per-block result keyed alongside `blocks` order. */
export interface PageBlockResult {
  blockIndex: number;
  /** Echo of the entry's id, if any, so callers can correlate without index math. */
  id?: string;
  result: BlockResult;
}

export interface PageResult {
  matched: boolean;
  perBlock: PageBlockResult[];
}
