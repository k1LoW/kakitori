import type {
  BlockLoaders,
  BlockResult,
  BlockSpec,
  FreeCellLogger,
  WritingMode,
} from "../block/index.js";
import type { CharResult, GridOptions } from "../charOptions.js";

/** A block plus an optional identifier echoed back through {@link PageResult}. */
export interface PageBlockEntry {
  spec: BlockSpec;
  /**
   * Optional identifier echoed as `BlockResult.id` so callers can
   * correlate aggregated results with their original input without
   * indexing into the blocks array. Reachable from `onBlockComplete`
   * via `result.id` and from `Page.result().blocks[i].id`; the
   * `onCellComplete` callback only receives `blockIndex` and does not
   * surface the id.
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
  drawingWidth?: number;
  annotationDrawingWidth?: number;
  cellBorderWidth?: number;
  cellBorderColor?: string;
  freeCellLeniency?: number;
  /**
   * Page-wide stroke-matcher leniency applied to every guided cell on
   * the page. Forwarded as `BlockCreateOptions.leniency` to each
   * block, which threads it down to each cell's underlying
   * `char.create`. Per-cell `overrides.leniency` still wins.
   */
  leniency?: number;
  /**
   * Page-wide default for {@link MountOptions.retainStrokes}: forwarded
   * to every block's `block.create()`. Per-block / per-cell overrides
   * still win.
   */
  retainStrokes?: boolean;
  /** Page-wide default for {@link MountOptions.retainedStrokeColor}. */
  retainedStrokeColor?: string;
  /** Page-wide default for {@link MountOptions.retainedStrokeWidth}. */
  retainedStrokeWidth?: number;
  /**
   * Page-wide default for {@link MountOptions.showAcceptedStroke}:
   * forwarded to every block's `block.create()`. Per-block / per-cell
   * overrides still win.
   */
  showAcceptedStroke?: boolean;
  /**
   * Page-wide default for {@link BlockCreateOptions.correction}:
   * forwarded to every block. Per-block / per-cell overrides still win.
   *
   * - `"per-page"`: real page-wide deferral of **writeable** cells
   *   (guided write, free write, write-mode annotations). Injects
   *   block-level `"deferred"` into every block. The page
   *   coordinator holds off every writeable verdict until every
   *   segment block has captured; then it walks each block in order
   *   and fires `Block.check()`, so the write-mode
   *   `onCellComplete` / `onBlockComplete` / `onPageComplete` land
   *   in one burst once the whole page is written. Show-mode cells
   *   and blank cells are not writable inputs — their synthetic
   *   `onCellComplete` still fires at create time as before, and
   *   block / page commits wait on the write-mode cells alongside
   *   them.
   */
  correction?: "per-stroke" | "per-char" | "per-block" | "per-page";
  /**
   * Page-wide cap on in-place retries for every writeable entry —
   * forwarded to every block as {@link BlockCreateOptions.maxRetries},
   * which in turn cascades to guided cells
   * ({@link MountOptions.maxRetries}) and free cells / annotation
   * free cells ({@link FreeCellCreateOptions.maxRetries}). Per-block
   * / per-cell overrides still win.
   */
  maxRetries?: number;
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
    chars: CharResult[],
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
  /**
   * Composite result of every user-block on this page — same shape as
   * the value passed to `onPageComplete` (where `complete` is always
   * `true`). Pure getter; safe to poll at any time.
   */
  result(): PageResult;
  /**
   * External burst-check trigger for `correction: "per-page"` pages.
   * Calls `Block.check()` on every block; each block then runs its
   * burst-check, which fires `onCellComplete` /
   * `onBlockComplete` / `onPageComplete` in order.
   *
   * Refuses to run (logs through the page's logger and no-ops)
   * unless every deferred entry across every block has already
   * fired its captured signal — partial-commit would leave
   * un-captured entries hanging. Also no-ops when the automatic
   * burst already fired (the last captured signal across the page
   * triggers the burst on its own). The method is primarily useful
   * as a `Submit`-style host trigger in a window where you want to
   * manually own the burst BEFORE the auto-trigger fires (e.g.
   * `reset()` immediately followed by `check()` on an empty page).
   *
   * No-op on pages mounted under any other correction mode — those
   * finalize through their own per-cell / per-block paths.
   */
  check(): void;
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

/**
 * Composite result of every user-block on this page. Returned by
 * {@link Page.result} at any time and passed to `onPageComplete` once
 * `complete` flips true.
 *
 * `blocks` contains `BlockResult` values directly — no wrapper.
 * Position in `blocks` matches the position in `opts.blocks` (and the
 * `blockIndex` callbacks see). Each `BlockResult.id` echoes the
 * optional `PageBlockEntry.id`.
 */
export interface PageResult {
  /** Every cell + annotation across every block has settled. */
  complete: boolean;
  /**
   * Every **completed** character (`CharResult.complete === true`)
   * across every block matched. In-progress chars are excluded, so
   * `matched: true` with `complete: false` means "no failures yet"
   * rather than "everything matched". Vacuously `true` until the
   * first character settles anywhere on the page.
   */
  matched: boolean;
  /**
   * Per-block results in `PageCreateOptions.blocks` order. Each entry's
   * `id` echoes the corresponding `PageBlockEntry.id`.
   */
  blocks: BlockResult[];
}

/**
 * Options for `page.restore`, the static result renderer for a
 * {@link PageResult}. Mirrors `page.create`'s layout vocabulary
 * (`columns` / `cellsPerColumn` / `cellSize` / `writingMode`) plus the
 * per-char visual knobs forwarded to {@link RestoreOptions}. The page
 * layout is not stored on `PageResult` (so the same result can be
 * rendered at different shapes); the caller passes it here.
 *
 * Annotations are rendered alongside each block's cells whenever a
 * `BlockAnnotationResult` carries the `cellRange` / `placement` /
 * `sizeRatio` layout fields. If a block's `cellRange` straddles a
 * column wrap, the annotation is split per-cell across the segments
 * the cells land in, so each cell keeps the chars it originally
 * carried in the live block.
 */
export interface PageRestoreOptions {
  /** Page column count (vertical-rl) or row count (horizontal-tb). Required. */
  columns: number;
  /** Cells per column (vertical-rl) or per row (horizontal-tb). Required. */
  cellsPerColumn: number;
  /** Per-cell side length in display pixels. Required. */
  cellSize: number;
  /** Layout direction. Defaults to `"vertical-rl"`. */
  writingMode?: WritingMode;
  /** Per-cell padding inside the cell box. Defaults to 0. */
  padding?: number;
  /** Cell border width in display pixels. Defaults to 1. */
  cellBorderWidth?: number;
  /** Cell border color. Defaults to `"#ddd"`, matching `page.create`. */
  cellBorderColor?: string;
  /**
   * When `false`, no annotation strip is reserved or rendered on
   * any block, even if some blocks carry annotations. Defaults to
   * `true`, matching `page.create`: the strip is reserved on every
   * column regardless of whether any block carries furigana, so a
   * `PageResult` round-trips through `page.create` and
   * `page.restore` at the same geometry.
   */
  showAnnotationStrip?: boolean;
  /**
   * Override the page-wide annotation strip thickness. When unset,
   * the thickness is `Math.max(largest block annotation thickness,
   * DEFAULT_ANNOTATION_RATIO * cellSize)`, unconditionally
   * applying the default floor (matching `page.create`). Must be
   * at least as large as the largest required block thickness;
   * otherwise the call throws.
   */
  annotationStripThickness?: number;
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
  charDataLoader?: import("../charOptions.js").CharDataLoaderFn;
}
