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

/** A block plus optional id / label surfaced through callbacks. */
export interface PageBlockEntry {
  spec: BlockSpec;
  /** Identifier echoed back to callbacks and result aggregation. */
  id?: string;
  /** Free-form label (e.g. "問1") forwarded only for display / debugging. */
  label?: string;
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
   * Width (vertical-rl) / height (horizontal-tb) reserved per column for
   * annotations (ふりがな等). When omitted, derived from the largest
   * `sizeRatio * cellSize` across the page's blocks (0 if no block has
   * annotations).
   */
  annotationStripThickness?: number;
  /**
   * Draw a faint cell-grid background. `true` uses the cell-border style;
   * `false` disables it; an object overrides color / width.
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
  /** Destroy every child block and detach the page. */
  destroy(): void;
}

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
