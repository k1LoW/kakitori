import { char, type Char } from "../char.js";
import type {
  CharCreateOptions,
  CharResult,
  GridOptions,
  MountOptions,
} from "../charOptions.js";
import { DEFAULT_PADDING, HANZI_PRESCALED_SIZE } from "../constants.js";
import type { CharStrokeData } from "../types.js";
import { createFreeCell, type FreeCellHandle, type FreeCellLogger } from "./freeCell.js";
import type {
  BlankCell,
  BlockAnnotationResult,
  BlockCellResult,
  BlockLoaders,
  BlockResult,
  BlockSpec,
  Cell,
  FuriganaAnnotation,
  GuidedCell,
  FreeCell,
} from "./types.js";

const DEFAULT_CELL_SIZE = 120;
const DEFAULT_ANNOTATION_RATIO = 0.4;
const DEFAULT_CELL_BORDER_WIDTH = 1;
const DEFAULT_CELL_BORDER_COLOR = "#ddd";
/**
 * Block-wide stroke width default in **display pixels**. Tuned for a
 * ~120-150px cell (about 3% of the cell's longer side); guided / free /
 * annotation all use this, so adjust here to scale every cell at once.
 */
const DEFAULT_BLOCK_DRAWING_WIDTH = 4;
/** Shared dashArray for the cross-grid drawn inside guided cells (via
 * char.mount) and blank cells (via drawBlankCrossGrid), so both kinds
 * render the same dash style by default. Free cells don't draw a
 * cross-grid. */
const DEFAULT_GRID_DASH_ARRAY = "3,3";

export type WritingMode = "vertical-rl" | "horizontal-tb";

export interface BlockCreateOptions {
  spec: BlockSpec;
  /** Per-cell side length in display pixels. */
  cellSize?: number;
  /** Layout direction. Defaults to `'vertical-rl'` (Japanese practice book convention). */
  writingMode?: WritingMode;
  /** Loaders shared by every Char inside the block. */
  loaders?: BlockLoaders;
  // Free-cell drawing customization (forwarded as-is to createFreeCell).
  drawingColor?: string;
  matchedColor?: string;
  failedColor?: string;
  drawingWidth?: number;
  /**
   * Drawing width for annotation cells (ふりがな等). Defaults to whatever
   * `drawingWidth` resolves to (i.e. the cell stroke width verbatim), so
   * annotations and cells share the same line thickness unless explicitly
   * overridden here.
   */
  annotationDrawingWidth?: number;
  /**
   * Reserve a furigana strip alongside every cell with this thickness in
   * display pixels, even when the spec contains no annotations. Used by
   * the page primitive to keep every block on a page the same width
   * (cellSize + annotationThickness) so block stacking is uniform. When
   * omitted, the block sizes its strip from the largest annotation's
   * `sizeRatio * cellSize` (or 0 if there are no annotations).
   */
  annotationThickness?: number;
  /**
   * Cross-grid background for guided cells. Defaults to `true` (a練習帳-style
   * cross). Pass `false` to disable, or a `GridOptions` object to customize
   * color / dash / width. Per-cell overrides via `GuidedCell.overrides` win.
   */
  showGrid?: boolean | GridOptions;
  /** Border width (in display pixels) for every cell and annotation wrapper.
   * Also reused as the line width for the cross-grid inside guided cells when
   * `showGrid` is left as the boolean default. Defaults to `1`. */
  cellBorderWidth?: number;
  /** Border color for every cell and annotation wrapper, plus the matching
   * cross-grid line color inside guided cells. Defaults to `'#ddd'`. */
  cellBorderColor?: string;
  /**
   * Block-wide default for {@link MountOptions.retainStrokes}: when
   * `true`, every guided cell in this block accumulates its user-drawn
   * ink as polylines (practice-paper feel). Per-cell
   * `GuidedCell.overrides` still wins.
   */
  retainStrokes?: boolean;
  /** Block-wide default for {@link MountOptions.retainedStrokeColor}. */
  retainedStrokeColor?: string;
  /** Block-wide default for {@link MountOptions.retainedStrokeWidth}. */
  retainedStrokeWidth?: number;
  /**
   * Block-wide default for {@link MountOptions.showAcceptedStroke}: when
   * `false`, hanzi-writer's official stroke is hidden after each cell
   * stroke is accepted. Per-cell `GuidedCell.overrides` still wins.
   */
  showAcceptedStroke?: boolean;
  /**
   * Correction granularity across this block. Default
   * `"per-stroke"`.
   *
   * - `"per-stroke"`: forwarded to every guided cell (hanzi-writer
   *   quiz corrects per stroke).
   * - `"per-char"`: every guided cell is mounted with `correction:
   *   "per-char"` — the user writes each character freely and the
   *   verdict lands when the character is fully drawn.
   * - `"per-block"`: **today observationally identical to
   *   `"per-char"`** — every cell still checks at character completion
   *   and `onBlockComplete` still fires after the final cell. The
   *   value is preserved so callers who want block-level deferred
   *   check can opt in today and pick up the real behavior (no
   *   per-cell dispatch until the whole block is drawn) in a future
   *   version without changing their call site.
   *
   * Per-cell `GuidedCell.overrides.correction` still wins.
   */
  correction?: "per-stroke" | "per-char" | "per-block";
  /** Verbose lifecycle / matching trace shared by free cells and annotations. */
  logger?: FreeCellLogger;
  /**
   * Debug overlay: draws the per-character bbox the matcher used in every
   * free-cell / annotation match attempt. Off by default.
   */
  showSegmentBoxes?: boolean;
  /** Color for the segment bbox overlay (debug). */
  segmentBoxColor?: string;
  /**
   * Stroke-matcher leniency applied to free cell / annotation per-character
   * Chars. Higher = more permissive. Free cells default to a looser value
   * than guided cells; see `freeCell.ts` for the default.
   */
  freeCellLeniency?: number;
  /**
   * Fired for every cell or annotation that finishes settling — `chars`
   * is the per-character snapshot for that unit (length matches the
   * corresponding `BlockCellResult.chars` / `BlockAnnotationResult.chars`).
   */
  onCellComplete?: (
    index: number,
    kind: "cell" | "annotation",
    chars: CharResult[],
  ) => void;
  /** Fired once every cell and annotation has finished settling. */
  onBlockComplete?: (result: BlockResult) => void;
  /**
   * Fired whenever any cell or annotation in this block receives a stroke
   * (correct or wrong). Lets a wrapping page track which block was most
   * recently active so a delegated `page.undo()` can be routed here.
   */
  onActivity?: () => void;
}

export interface Block {
  /** Underlying container element. The block is mounted as its child. */
  el: HTMLElement;
  /** Reset every cell and annotation to a clean writing state. */
  reset(): void;
  /**
   * Cell-level undo: revert just the cell or annotation that received
   * the most recent stroke. Returns a descriptor of what was undone
   * plus `hasMore` indicating whether another `undo()` call would still
   * find earlier activity in this block. Returns `null` when nothing is
   * left to undo (so a wrapping page can fall through to another block).
   */
  undo(): {
    kind: "cell" | "annotation";
    index: number;
    hasMore: boolean;
  } | null;
  /**
   * Composite result of the block at this exact moment — same shape as
   * the value passed to `onBlockComplete` (where `complete` is always
   * `true`). Pure getter; safe to poll at any time.
   */
  result(): BlockResult;
  /** Destroy every child Char / freeCell and detach the block. */
  destroy(): void;
}

/**
 * `block` namespace — `block.create()` builds a single-row writing block by
 * laying out guided cells (Char-backed) and free cells (free-form judging)
 * left-to-right (horizontal-tb) or top-to-bottom (vertical-rl), with an
 * optional annotation strip (e.g. ふりがな) placed perpendicular to the
 * main cell axis.
 */
export const block = {
  create(target: HTMLElement | string, opts: BlockCreateOptions): Block {
    const container = resolveTarget(target);
    return createBlock(container, opts);
  },
};

function resolveTarget(target: HTMLElement | string): HTMLElement {
  if (typeof target === "string") {
    const found = document.querySelector(target);
    if (!found) {
      throw new Error(`block.create(): selector "${target}" did not match any element.`);
    }
    return found as HTMLElement;
  }
  return target;
}

interface PerCellState {
  index: number;
  cell: Cell;
  /**
   * Flips true once this cell has fired `onCellComplete`. Drives the
   * one-shot completion callback semantics — completion is observable
   * from the cell's `chars` snapshot too, but we don't want to re-emit
   * the callback every time the user re-touches a finished cell.
   */
  committed: boolean;
  /**
   * Synthetic `chars` for show-mode / blank cells. Live (write-mode)
   * cells get their snapshot from `charInstance.result()` /
   * `freeHandle.results()` instead.
   */
  syntheticChars?: CharResult[];
  // Resources tied to this cell, depending on kind.
  charInstance?: Char;
  freeHandle?: FreeCellHandle;
  charCellEl?: HTMLDivElement;
  /**
   * True when this guided write cell was mounted under per-block
   * deferral (its char has `correction: "deferred"`). Lets the
   * coordinator re-register the cell with `perBlockPending` on
   * `reset()` without re-resolving the block-wide option.
   */
  usesDeferredCorrection?: boolean;
}

interface PerAnnotationState {
  index: number;
  annotation: FuriganaAnnotation;
  freeHandle: FreeCellHandle | null;
  /** Same role as `PerCellState.committed`. */
  committed: boolean;
  /** For show-mode annotations the chars are synthesized once and stay fixed. */
  syntheticChars?: CharResult[];
}

function createBlock(parent: HTMLElement, opts: BlockCreateOptions): Block {
  const cellSize = opts.spec.size ?? opts.cellSize ?? DEFAULT_CELL_SIZE;
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(
      `block.create(): cellSize must be a finite positive number (got ${cellSize}).`,
    );
  }
  const writingMode = opts.writingMode ?? "vertical-rl";
  if (writingMode !== "vertical-rl" && writingMode !== "horizontal-tb") {
    throw new Error(
      `block.create(): writingMode must be "vertical-rl" or "horizontal-tb" (got ${JSON.stringify(writingMode)}).`,
    );
  }
  const annotations = opts.spec.annotations ?? [];
  const cells = opts.spec.cells;
  validateBlockSpec(cells, annotations, writingMode);
  const resolvedDrawingWidth = opts.drawingWidth ?? DEFAULT_BLOCK_DRAWING_WIDTH;
  const cellBorderWidth = opts.cellBorderWidth ?? DEFAULT_CELL_BORDER_WIDTH;
  const cellBorderColor = opts.cellBorderColor ?? DEFAULT_CELL_BORDER_COLOR;
  const resolvedCellBorder = `${cellBorderWidth}px solid ${cellBorderColor}`;

  // Compute the annotation strip thickness. Caller (e.g. page) can pin
  // it via `opts.annotationThickness`; otherwise it's derived from the
  // largest annotation's sizeRatio (0 when there are no annotations).
  // When > 0, the block reserves a strip alongside every cell — even
  // those without annotation content — so block stacking on a page
  // stays visually uniform.
  const requiredAnnotationThickness =
    annotations.length === 0
      ? 0
      : Math.max(
          ...annotations.map((a) => (a.sizeRatio ?? DEFAULT_ANNOTATION_RATIO) * cellSize),
        );
  if (opts.annotationThickness !== undefined) {
    if (
      !Number.isFinite(opts.annotationThickness) ||
      opts.annotationThickness < 0
    ) {
      throw new Error(
        `block.create(): annotationThickness must be a finite non-negative number (got ${opts.annotationThickness}).`,
      );
    }
    if (opts.annotationThickness < requiredAnnotationThickness) {
      throw new Error(
        `block.create(): annotationThickness=${opts.annotationThickness} is smaller than the largest annotation's required thickness (${requiredAnnotationThickness}).`,
      );
    }
  }
  const annotationThickness =
    opts.annotationThickness !== undefined
      ? opts.annotationThickness
      : requiredAnnotationThickness;

  const cellsExtent = cells.reduce((acc, c) => acc + cellSlotSpan(c) * cellSize, 0);

  // Container is a positioned wrapper so children can be absolutely placed.
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-block";
  wrapper.style.lineHeight = "0";
  // Layout dimensions: along the cell axis we span `cellsExtent` and along
  // the perpendicular axis we span `cellSize + annotationThickness`.
  if (writingMode === "horizontal-tb") {
    wrapper.style.width = `${cellsExtent}px`;
    wrapper.style.height = `${cellSize + annotationThickness}px`;
  } else {
    // vertical-rl
    wrapper.style.width = `${cellSize + annotationThickness}px`;
    wrapper.style.height = `${cellsExtent}px`;
  }
  parent.appendChild(wrapper);

  const cellRects: Array<{ x: number; y: number; w: number; h: number; spanCells: number }> = [];
  let runningOffset = 0;
  for (const cell of cells) {
    const span = cellSlotSpan(cell);
    const w = writingMode === "horizontal-tb" ? span * cellSize : cellSize;
    const h = writingMode === "horizontal-tb" ? cellSize : span * cellSize;
    const x = writingMode === "horizontal-tb" ? runningOffset : 0;
    const y = writingMode === "horizontal-tb"
      ? annotationThickness // cells sit BELOW the annotation strip
      : runningOffset;
    cellRects.push({ x, y, w, h, spanCells: span });
    runningOffset += span * cellSize;
  }

  // Layout annotation rects. v1 only supports `top` (horizontal-tb) and
  // `right` (vertical-rl); `validateBlockSpec` rejects others up front.
  function annotationRect(a: FuriganaAnnotation): { x: number; y: number; w: number; h: number } {
    const [from, to] = a.cellRange;
    const start = cellRects[from];
    const end = cellRects[to];
    const ratio = a.sizeRatio ?? DEFAULT_ANNOTATION_RATIO;
    if (writingMode === "horizontal-tb") {
      const h = cellSize * ratio;
      return {
        x: start.x,
        y: annotationThickness - h,
        w: end.x + end.w - start.x,
        h,
      };
    }
    return {
      x: cellSize,
      y: start.y,
      w: cellSize * ratio,
      h: end.y + end.h - start.y,
    };
  }

  const cellStates: PerCellState[] = [];
  const annotationStates: PerAnnotationState[] = [];
  // Set by destroy() so deferred callbacks (await ready().then(start),
  // queueMicrotask) can no-op instead of touching DOM / Char instances
  // that have already been torn down.
  let destroyed = false;

  // ===== Per-block real-deferral coordinator =====
  // Populated for every guided cell mounted with `correction: "deferred"`
  // (when block-wide `correction` is `"per-block"`). The cell fires
  // `onCharCaptured` once the user finishes drawing the character; we
  // hold off triggering correction on ANY cell until every entry in
  // this set has fired. When the set drains, we call `check()` on each
  // cell in turn — that fires their `onComplete` callbacks, which
  // route through the existing `commitGuidedCell` → `onCellComplete`
  // chain, so the block emits per-cell verdicts in one burst at the
  // end instead of letting each cell judge itself mid-write.
  const perBlockPending = new Set<number>();
  let perBlockTriggered = false;

  /**
   * Activity history for {@link Block.undo}. Most recent target is at
   * the end. We dedup by target so each cell / annotation appears at
   * most once: re-touching a cell moves it to the top instead of
   * piling duplicate entries that would later collapse to no-ops.
   */
  const activityStack: Array<{ kind: "cell" | "annotation"; index: number }> = [];
  function markActive(kind: "cell" | "annotation", index: number): void {
    const existing = activityStack.findIndex(
      (t) => t.kind === kind && t.index === index,
    );
    if (existing >= 0) {
      activityStack.splice(existing, 1);
    }
    activityStack.push({ kind, index });
    opts.onActivity?.();
  }

  // Reserve an empty annotation strip frame next to every cell-slot
  // (one per slot in the span) so block-stacking on a page stays
  // visually uniform whether or not an annotation lands on that slot.
  // mountAnnotation paints content on top of these frames where
  // applicable.
  if (annotationThickness > 0) {
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const rect = cellRects[i];
      const span = cellSlotSpan(cell);
      for (let k = 0; k < span; k++) {
        drawEmptyAnnotationStripFrame(rect, k);
      }
    }
  }

  // Mount each cell.
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const rect = cellRects[i];
    if (cell.kind === "guided") {
      cellStates.push(mountGuidedCell(wrapper, rect, cell, i));
    } else if (cell.kind === "free") {
      cellStates.push(mountFreeCell(wrapper, rect, cell, i));
    } else {
      cellStates.push(mountBlankCell(wrapper, rect, cell, i));
    }
  }

  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i];
    const rect = annotationRect(annotation);
    const state = mountAnnotation(wrapper, rect, annotation, i);
    annotationStates.push(state);
  }

  function drawEmptyAnnotationStripFrame(
    cellRect: { x: number; y: number; w: number; h: number; spanCells: number },
    slotIndex: number,
  ): void {
    const frame = document.createElement("div");
    frame.style.position = "absolute";
    frame.style.boxSizing = "border-box";
    frame.style.pointerEvents = "none";
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    if (writingMode === "vertical-rl") {
      x = cellRect.x + cellSize;
      y = cellRect.y + slotIndex * cellSize;
      w = annotationThickness;
      h = cellSize;
    } else {
      x = cellRect.x + slotIndex * cellSize;
      y = cellRect.y - annotationThickness;
      w = cellSize;
      h = annotationThickness;
    }
    frame.style.left = `${x}px`;
    frame.style.top = `${y}px`;
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    applyBorder(frame, resolvedCellBorder, NO_HIDE);
    wrapper.appendChild(frame);
  }

  function mountGuidedCell(
    parentEl: HTMLElement,
    rect: { x: number; y: number; w: number; h: number },
    cell: GuidedCell,
    index: number,
  ): PerCellState {
    const cellEl = document.createElement("div");
    cellEl.style.position = "absolute";
    cellEl.style.left = `${rect.x}px`;
    cellEl.style.top = `${rect.y}px`;
    cellEl.style.width = `${rect.w}px`;
    cellEl.style.height = `${rect.h}px`;
    cellEl.style.boxSizing = "border-box";
    applyBorder(cellEl, resolvedCellBorder, cellEdgesToHide(index, cells.length, writingMode));
    parentEl.appendChild(cellEl);

    const overrides = cell.overrides ?? {};
    const createOpts: CharCreateOptions = {
      ...(opts.loaders?.charDataLoader ? { charDataLoader: opts.loaders.charDataLoader } : {}),
      ...(opts.loaders?.configLoader !== undefined ? { configLoader: opts.loaders.configLoader } : {}),
      ...pickCreateOpts(overrides),
    };
    const c = char.create(cell.char, createOpts);

    // `showGrid: true` (default) means "draw the cross-grid in the cell-border
    // style". Plumb the cell-border width / color through so the grid lines
    // inside guided cells visually match the wrapper border, and pin a
    // shared default dashArray so guided/free/blank cross-grids are
    // visually identical (char's own default is "10,10", which would
    // diverge from the blank cell's "3,3" without this).
    const userShowGrid = opts.showGrid ?? true;
    let blockShowGrid: NonNullable<MountOptions["showGrid"]>;
    if (userShowGrid === true) {
      blockShowGrid = {
        color: cellBorderColor,
        width: cellBorderWidth,
        dashArray: DEFAULT_GRID_DASH_ARRAY,
      };
    } else if (userShowGrid === false) {
      blockShowGrid = false;
    } else {
      blockShowGrid = {
        ...userShowGrid,
        ...(userShowGrid.dashArray === undefined
          ? { dashArray: DEFAULT_GRID_DASH_ARRAY }
          : {}),
      };
    }
    // hanzi-writer's `drawingWidth` is interpreted in its internal coord
    // system (HANZI_PRESCALED_SIZE). The character is rendered into the
    // inner padded area, so the display-px → internal-units factor is
    // `HANZI_PRESCALED_SIZE / innerSize` (innerSize = rect.w - 2 * padding).
    // Without accounting for an `overrides.padding`, guided strokes would
    // silently drift thicker than free-cell strokes.
    const resolvedPadding = overrides.padding ?? DEFAULT_PADDING;
    const innerSize = rect.w - 2 * resolvedPadding;
    const guidedDrawingWidth =
      innerSize > 0 ? (resolvedDrawingWidth * HANZI_PRESCALED_SIZE) / innerSize : resolvedDrawingWidth;

    // Map the block-wide `correction` value to what each guided cell
    // should be mounted with. Resolved up here (instead of as a
    // conditional spread) so we can log when an unknown value comes
    // through — TypeScript catches the public surface, but raw-JS
    // callers OR a future enum addition (e.g. `"per-page"` reaching
    // this layer via page.ts) could trip the silent-drop path otherwise.
    let cellCorrection: MountOptions["correction"] | undefined;
    if (opts.correction === "per-block") {
      // Real block-wide deferral: every guided cell captures strokes
      // but does NOT auto-correct. The block coordinator collects
      // captures across cells and fires correction on all of them
      // together once every cell has finished writing.
      cellCorrection = "deferred";
    } else if (opts.correction === "per-char") {
      cellCorrection = "per-char";
    } else if (opts.correction === "per-stroke") {
      cellCorrection = "per-stroke";
    } else if (opts.correction !== undefined) {
      opts.logger?.(`block: unknown correction "${String(opts.correction)}" ignored`);
    }

    const mountOpts: MountOptions = {
      size: rect.w,
      showGrid: blockShowGrid,
      // Apply the block-wide drawingWidth so guided / free / annotation
      // cells share line thickness by default. Per-cell overrides below
      // (via `pickMountOpts`) still win.
      drawingWidth: guidedDrawingWidth,
      // Block-wide retain-strokes defaults; per-cell overrides below win.
      ...(opts.retainStrokes !== undefined
        ? { retainStrokes: opts.retainStrokes }
        : {}),
      ...(opts.retainedStrokeColor !== undefined
        ? { retainedStrokeColor: opts.retainedStrokeColor }
        : {}),
      ...(opts.retainedStrokeWidth !== undefined
        ? { retainedStrokeWidth: opts.retainedStrokeWidth }
        : {}),
      ...(opts.showAcceptedStroke !== undefined
        ? { showAcceptedStroke: opts.showAcceptedStroke }
        : {}),
      // Per-cell `overrides.correction` (forwarded via
      // `pickMountOpts(overrides)` below) still wins over this
      // block-wide default.
      ...(cellCorrection !== undefined ? { correction: cellCorrection } : {}),
      // In write mode the quiz starts asynchronously after `await ready()`.
      // hanzi-writer's mount default would render the character visibly
      // during that gap — flash the answer to the user. Hide it from the
      // start so the cell is blank until quiz reveals strokes one by one.
      ...(cell.mode === "write" ? { showCharacter: false } : {}),
      ...pickMountOpts(overrides),
    };
    const state: PerCellState = {
      index,
      cell,
      committed: false,
      charInstance: c,
      charCellEl: cellEl,
    };

    if (cell.mode === "write") {
      // Quiz mode: instrument callbacks for activity tracking + completion.
      mountOpts.onCorrectStroke = (data) => handleGuidedStroke(state, data);
      mountOpts.onMistake = (data) => handleGuidedStroke(state, data);
      mountOpts.onStrokeEndingMistake = (data) => handleGuidedStroke(state, data);
      mountOpts.onComplete = () => commitGuidedCell(state);
      // pickMountOpts(overrides) above can swap the cell's correction
      // back to per-stroke / per-char via per-cell overrides; honor
      // the EFFECTIVE value here, not the block-wide one.
      const effectiveCorrection = mountOpts.correction;
      if (effectiveCorrection === "deferred") {
        // Register this cell with the per-block coordinator. Its
        // captures arrive via onCharCaptured; correction only kicks
        // off once every pending cell has fired.
        perBlockPending.add(index);
        mountOpts.onCharCaptured = () => onPerBlockCellCaptured(index);
        state.usesDeferredCorrection = true;
      }
      c.mount(cellEl, mountOpts);
      // Kick off the quiz once ready.
      void c.ready().then(() => {
        if (destroyed || !state.charInstance) {
          return;
        }
        c.start();
      });
    } else {
      // Show mode: render the character and synthesize a complete
      // CharResult so block aggregation can settle even though the user
      // never writes anything.
      c.mount(cellEl, mountOpts);
      state.syntheticChars = [
        {
          character: cell.char,
          complete: true,
          matched: true,
          perStroke: [],
          source: "guided",
          mode: "show",
        },
      ];
      queueMicrotask(() => {
        if (destroyed) {
          return;
        }
        commitGuidedCell(state);
      });
    }
    return state;
  }

  function handleGuidedStroke(
    state: PerCellState,
    _data: CharStrokeData,
  ): void {
    markActive("cell", state.index);
  }

  /**
   * Per-block coordinator: a guided cell mounted with `correction:
   * "deferred"` just told us it captured a full character. Mark it
   * done; once every registered cell has fired, walk the cells in
   * order and call `check()` on each so they all run correction in
   * the same burst. The `onComplete` callback each `check()` fires
   * routes through `commitGuidedCell` → `onCellComplete`, and the
   * existing `maybeCommitBlock` then emits `onBlockComplete` once the
   * last cell settles — preserving the public callback order without
   * the block needing to learn about correction internals.
   */
  function onPerBlockCellCaptured(cellIndex: number): void {
    if (destroyed) {
      return;
    }
    markActive("cell", cellIndex);
    perBlockPending.delete(cellIndex);
    if (perBlockPending.size > 0 || perBlockTriggered) {
      return;
    }
    perBlockTriggered = true;
    for (const s of cellStates) {
      s.charInstance?.check();
    }
  }

  function commitGuidedCell(state: PerCellState): void {
    if (state.committed) {
      return;
    }
    state.committed = true;
    const chars = guidedCellChars(state);
    opts.onCellComplete?.(state.index, "cell", chars);
    maybeCommitBlock();
  }

  function guidedCellChars(state: PerCellState): CharResult[] {
    if (state.syntheticChars) {
      // synthesizeShowChars / mountGuidedCell show-mode already set
      // source + mode on each entry.
      return state.syntheticChars;
    }
    if (state.charInstance) {
      // Char.result() is the standalone shape (source / mode undefined).
      // Stamp the cell-context source + mode here so consumers iterating
      // the BlockResult tree don't need to know about the cell's mode.
      return [{ ...state.charInstance.result(), source: "guided", mode: "write" }];
    }
    return [];
  }

  function mountFreeCell(
    parentEl: HTMLElement,
    rect: { x: number; y: number; w: number; h: number },
    cell: FreeCell,
    index: number,
  ): PerCellState {
    // A free cell is one writing area sized to span * cellSize. We do
    // NOT subdivide it into per-slot sub-cells: the user writes the
    // answer across the rectangle freely and the matcher segments by
    // stroke counts.
    const wrapperEl = document.createElement("div");
    wrapperEl.style.position = "absolute";
    wrapperEl.style.left = `${rect.x}px`;
    wrapperEl.style.top = `${rect.y}px`;
    wrapperEl.style.width = `${rect.w}px`;
    wrapperEl.style.height = `${rect.h}px`;
    wrapperEl.style.boxSizing = "border-box";
    applyBorder(wrapperEl, resolvedCellBorder, NO_HIDE);
    parentEl.appendChild(wrapperEl);

    if (cell.mode === "show") {
      renderShowText(wrapperEl, firstCandidate(cell.expected), rect, writingMode);
      const state: PerCellState = {
        index,
        cell,
        committed: false,
        syntheticChars: synthesizeShowChars(cell.expected, "free"),
      };
      queueMicrotask(() => {
        if (destroyed) {
          return;
        }
        commitShowOrBlankCell(state, "cell");
      });
      return state;
    }

    const handle = createFreeCell({
      expected: cell.expected,
      surfaces: [{ parent: wrapperEl, width: rect.w, height: rect.h }],
      label: `cell#${index}`,
      ...(opts.drawingColor ? { drawingColor: opts.drawingColor } : {}),
      ...(opts.matchedColor ? { matchedColor: opts.matchedColor } : {}),
      ...(opts.failedColor ? { failedColor: opts.failedColor } : {}),
      drawingWidth: resolvedDrawingWidth,
      ...(opts.loaders ? { loaders: opts.loaders } : {}),
      ...(opts.logger ? { logger: opts.logger } : {}),
      ...(opts.showSegmentBoxes !== undefined ? { showSegmentBoxes: opts.showSegmentBoxes } : {}),
      ...(opts.segmentBoxColor ? { segmentBoxColor: opts.segmentBoxColor } : {}),
      ...(opts.freeCellLeniency !== undefined ? { leniency: opts.freeCellLeniency } : {}),
      onCellComplete: (chars: CharResult[]) => {
        if (state.committed) {
          return;
        }
        state.committed = true;
        opts.onCellComplete?.(index, "cell", chars);
        maybeCommitBlock();
      },
      onStroke: () => markActive("cell", index),
    });
    const state: PerCellState = {
      index,
      cell,
      committed: false,
      freeHandle: handle,
    };
    return state;
  }

  function synthesizeShowChars(
    expected: import("./types.js").Expected,
    source: "guided" | "free" | "annotation",
  ): CharResult[] {
    return Array.from(firstCandidate(expected)).map<CharResult>((ch) => ({
      character: ch,
      complete: true,
      matched: true,
      perStroke: [],
      source,
      mode: "show",
    }));
  }

  function commitShowOrBlankCell(
    state: PerCellState,
    kind: "cell" | "annotation",
  ): void {
    if (state.committed) {
      return;
    }
    state.committed = true;
    const chars = state.syntheticChars ?? [];
    opts.onCellComplete?.(state.index, kind, chars);
    maybeCommitBlock();
  }

  function mountBlankCell(
    parentEl: HTMLElement,
    rect: { x: number; y: number; w: number; h: number },
    cell: BlankCell,
    _index: number,
  ): PerCellState {
    // Render one independent cell-slot per span unit so a span=5 blank
    // shows up as 5 cells (each with its own border + cross-grid),
    // matching how guided cells stack along the same axis.
    const span = cellSlotSpan(cell);
    const userShowGrid = opts.showGrid ?? true;
    let color = cellBorderColor;
    let width = cellBorderWidth;
    let dashArray: string | undefined = DEFAULT_GRID_DASH_ARRAY;
    if (userShowGrid !== false) {
      const grid = (typeof userShowGrid === "object" ? userShowGrid : {});
      color = grid.color ?? cellBorderColor;
      width = grid.width ?? cellBorderWidth;
      dashArray = grid.dashArray ?? DEFAULT_GRID_DASH_ARRAY;
    }
    for (let k = 0; k < span; k++) {
      const slot = document.createElement("div");
      slot.style.position = "absolute";
      let sx: number;
      let sy: number;
      if (writingMode === "vertical-rl") {
        sx = rect.x;
        sy = rect.y + k * cellSize;
      } else {
        sx = rect.x + k * cellSize;
        sy = rect.y;
      }
      slot.style.left = `${sx}px`;
      slot.style.top = `${sy}px`;
      slot.style.width = `${cellSize}px`;
      slot.style.height = `${cellSize}px`;
      slot.style.boxSizing = "border-box";
      applyBorder(slot, resolvedCellBorder, NO_HIDE);
      parentEl.appendChild(slot);
      if (userShowGrid !== false) {
        drawBlankCrossGrid(
          slot,
          { w: cellSize, h: cellSize },
          1,
          writingMode,
          color,
          width,
          dashArray,
        );
      }
    }
    const state: PerCellState = {
      index: _index,
      cell,
      committed: false,
      // Blank cells have no characters to write; the empty array is
      // vacuously complete + matched.
      syntheticChars: [],
    };
    queueMicrotask(() => {
      if (destroyed) {
        return;
      }
      commitShowOrBlankCell(state, "cell");
    });
    return state;
  }

  function mountAnnotation(
    parentEl: HTMLElement,
    rect: { x: number; y: number; w: number; h: number },
    annotation: FuriganaAnnotation,
    index: number,
  ): PerAnnotationState {
    // Split the annotation strip into one sub-strip per covered cell so
    // the divider lines line up with the cell boundaries below — visually
    // matches a 練習帳 page where every kanji has its own furigana row.
    // For write mode the sub-strips become a multi-surface freeCell
    // sharing one stroke buffer, so the user can still write the answer
    // freely across them at character boundaries.
    const [annFrom, annTo] = annotation.cellRange;
    const cellCount = annTo - annFrom + 1;
    interface SubStrip {
      el: HTMLDivElement;
      width: number;
      height: number;
      cellIndex: number;
    }
    const subStrips: SubStrip[] = [];
    for (let k = 0; k < cellCount; k++) {
      const sub = document.createElement("div");
      sub.style.position = "absolute";
      let sx: number;
      let sy: number;
      let sw: number;
      let sh: number;
      if (writingMode === "vertical-rl") {
        sx = rect.x;
        sy = rect.y + k * cellSize;
        sw = rect.w;
        sh = cellSize;
      } else {
        sx = rect.x + k * cellSize;
        sy = rect.y;
        sw = cellSize;
        sh = rect.h;
      }
      sub.style.left = `${sx}px`;
      sub.style.top = `${sy}px`;
      sub.style.width = `${sw}px`;
      sub.style.height = `${sh}px`;
      sub.style.boxSizing = "border-box";
      // No border here: drawEmptyAnnotationStripFrame already paints the
      // strip frame underneath every cell-slot when annotationThickness >
      // 0, so the annotation overlay sits on top of that frame and only
      // contributes the freeCell surface / show-mode SVG content.
      parentEl.appendChild(sub);
      subStrips.push({ el: sub, width: sw, height: sh, cellIndex: annFrom + k });
    }

    if (annotation.mode === "show") {
      renderShowAcrossSubStrips(
        firstCandidate(annotation.expected),
        subStrips,
        writingMode,
      );
      const state: PerAnnotationState = {
        index,
        annotation,
        freeHandle: null,
        committed: false,
        syntheticChars: synthesizeShowChars(annotation.expected, "annotation"),
      };
      queueMicrotask(() => {
        if (destroyed) {
          return;
        }
        commitShowAnnotation(state);
      });
      return state;
    }

    const state: PerAnnotationState = {
      index,
      annotation,
      committed: false,
      freeHandle: createFreeCell({
        expected: annotation.expected,
        surfaces: subStrips.map((s) => ({ parent: s.el, width: s.width, height: s.height })),
        label: `annotation#${index}`,
        resultSource: "annotation",
        ...(opts.drawingColor ? { drawingColor: opts.drawingColor } : {}),
        ...(opts.matchedColor ? { matchedColor: opts.matchedColor } : {}),
        ...(opts.failedColor ? { failedColor: opts.failedColor } : {}),
        drawingWidth: opts.annotationDrawingWidth ?? resolvedDrawingWidth,
        ...(opts.loaders ? { loaders: opts.loaders } : {}),
        ...(opts.logger ? { logger: opts.logger } : {}),
        ...(opts.showSegmentBoxes !== undefined ? { showSegmentBoxes: opts.showSegmentBoxes } : {}),
        ...(opts.segmentBoxColor ? { segmentBoxColor: opts.segmentBoxColor } : {}),
        ...(opts.freeCellLeniency !== undefined ? { leniency: opts.freeCellLeniency } : {}),
        onCellComplete: (chars: CharResult[]) => {
          if (state.committed) {
            return;
          }
          state.committed = true;
          opts.onCellComplete?.(index, "annotation", chars);
          maybeCommitBlock();
        },
        onStroke: () => markActive("annotation", index),
      }),
    };
    return state;
  }

  function commitShowAnnotation(state: PerAnnotationState): void {
    if (state.committed) {
      return;
    }
    state.committed = true;
    const chars = state.syntheticChars ?? [];
    opts.onCellComplete?.(state.index, "annotation", chars);
    maybeCommitBlock();
  }

  function cellResult(state: PerCellState): BlockCellResult {
    if (state.cell.kind === "guided") {
      return { kind: "guided", chars: guidedCellChars(state) };
    }
    if (state.cell.kind === "free") {
      const chars = state.syntheticChars ?? state.freeHandle?.results() ?? [];
      return { kind: "free", chars };
    }
    // blank
    return { kind: "blank", chars: state.syntheticChars ?? [] };
  }

  function annotationResult(
    state: PerAnnotationState,
  ): BlockAnnotationResult {
    const chars = state.syntheticChars ?? state.freeHandle?.results() ?? [];
    return { chars };
  }

  function buildBlockResult(): BlockResult {
    const cellsOut = cellStates.map(cellResult);
    const annotationsOut = annotationStates.map(annotationResult);
    const allChars: CharResult[] = [];
    for (const c of cellsOut) {
      allChars.push(...c.chars);
    }
    for (const a of annotationsOut) {
      allChars.push(...a.chars);
    }
    const complete = allChars.every((c) => c.complete);
    const matched = allChars.filter((c) => c.complete).every((c) => c.matched);
    return { complete, matched, cells: cellsOut, annotations: annotationsOut };
  }

  let blockCommitted = false;
  function maybeCommitBlock(): void {
    if (blockCommitted) {
      return;
    }
    const allCellsCommitted = cellStates.every((s) => s.committed);
    const allAnnotationsCommitted = annotationStates.every((s) => s.committed);
    if (!allCellsCommitted || !allAnnotationsCommitted) {
      return;
    }
    blockCommitted = true;
    opts.onBlockComplete?.(buildBlockResult());
  }

  return {
    el: wrapper,
    reset(): void {
      if (destroyed) {
        return;
      }
      activityStack.length = 0;
      blockCommitted = false;
      // Re-arm the per-block coordinator so a fresh attempt waits for
      // every cell again. The Char-level `reset()` we call below drops
      // each cell's deferredCaptures buffer too.
      perBlockTriggered = false;
      perBlockPending.clear();
      for (const state of cellStates) {
        state.committed = false;
        if (state.cell.kind === "guided" && state.charInstance && state.charCellEl) {
          state.charInstance.reset();
          if (state.cell.mode === "write") {
            if (state.usesDeferredCorrection) {
              perBlockPending.add(state.index);
            }
            const inst = state.charInstance;
            void inst.ready().then(() => {
              if (destroyed) {
                return;
              }
              inst.start();
            });
          } else {
            queueMicrotask(() => {
              if (destroyed) {
                return;
              }
              commitGuidedCell(state);
            });
          }
        } else if (state.freeHandle) {
          state.freeHandle.reset();
        } else if (state.cell.kind === "free" && state.cell.mode === "show") {
          queueMicrotask(() => {
            if (destroyed) {
              return;
            }
            commitShowOrBlankCell(state, "cell");
          });
        } else if (state.cell.kind === "blank") {
          queueMicrotask(() => {
            if (destroyed) {
              return;
            }
            commitShowOrBlankCell(state, "cell");
          });
        }
      }
      for (const state of annotationStates) {
        state.committed = false;
        if (state.freeHandle) {
          state.freeHandle.reset();
        } else {
          queueMicrotask(() => {
            if (destroyed) {
              return;
            }
            commitShowAnnotation(state);
          });
        }
      }
    },
    undo(): {
      kind: "cell" | "annotation";
      index: number;
      hasMore: boolean;
    } | null {
      if (destroyed) {
        return null;
      }
      const target = activityStack.pop();
      if (!target) {
        return null;
      }
      if (target.kind === "cell") {
        const state = cellStates[target.index];
        if (!state) {
          return null;
        }
        // Roll the cell back to "in progress" so block-level aggregation
        // resets; the undo is silent (no callback re-fire).
        state.committed = false;
        blockCommitted = false;
        if (state.cell.kind === "guided" && state.charInstance) {
          state.charInstance.undo();
          if (state.usesDeferredCorrection) {
            // Per-block coordinator must learn that this cell is back
            // in-flight: it had been removed from `perBlockPending`
            // when its captures arrived. Without re-adding it, the
            // next cell's capture could drain the set early and
            // trigger `check()` on a cell that no longer has buffered
            // captures. Also clear `perBlockTriggered` so a later
            // re-completion can still kick off correction (otherwise
            // the coordinator believes it already fired).
            perBlockPending.add(target.index);
            perBlockTriggered = false;
          }
        } else if (state.freeHandle) {
          state.freeHandle.undo();
        }
        // blank / show-mode cells have nothing to undo (they don't
        // accept strokes, so they should never have been the
        // lastActiveTarget anyway).
      } else {
        const state = annotationStates[target.index];
        if (!state) {
          return null;
        }
        state.committed = false;
        blockCommitted = false;
        if (state.freeHandle) {
          state.freeHandle.undo();
        }
      }
      return {
        kind: target.kind,
        index: target.index,
        hasMore: activityStack.length > 0,
      };
    },
    result(): BlockResult {
      return buildBlockResult();
    },
    destroy(): void {
      destroyed = true;
      for (const state of cellStates) {
        if (state.charInstance) {
          state.charInstance.destroy();
        }
        if (state.freeHandle) {
          state.freeHandle.destroy();
        }
      }
      for (const state of annotationStates) {
        if (state.freeHandle) {
          state.freeHandle.destroy();
        }
      }
      if (wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
    },
  };
}

interface BorderHide {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

const NO_HIDE: BorderHide = { top: false, right: false, bottom: false, left: false };

function applyBorder(el: HTMLElement, border: string, hide: BorderHide): void {
  el.style.borderTop = hide.top ? "none" : border;
  el.style.borderRight = hide.right ? "none" : border;
  el.style.borderBottom = hide.bottom ? "none" : border;
  el.style.borderLeft = hide.left ? "none" : border;
}

/**
 * Edge-hiding stubs. Earlier versions hid the edges shared between
 * adjacent cells / annotation sub-strips so two 1px borders wouldn't
 * stack into a 2px line. The current model leaves every cell and strip
 * to draw its own complete frame so the visual is consistent regardless
 * of what (if anything) sits next to it; these functions stay around so
 * existing callers keep compiling, but always return NO_HIDE.
 */
function cellEdgesToHide(
  _index: number,
  _total: number,
  _writingMode: WritingMode,
): BorderHide {
  return { ...NO_HIDE };
}

interface SubStripView {
  el: HTMLDivElement;
  width: number;
  height: number;
}

/** Distribute a show-mode annotation's text across per-cell sub-strips
 * proportional to each sub-strip's cell coverage. Uses cumulative
 * rounding so the per-strip chunk is always non-negative even when the
 * reading has fewer characters than there are strips (e.g. 2-char reading
 * across 4 cells). For uniform readings (学校 → がっこう, 2 chars per
 * cell) the split lands cleanly on char boundaries; non-uniform readings
 * (大人 → おとな) hit a small visual quirk that explicit per-cell
 * expected strings would resolve in a future revision. */
function renderShowAcrossSubStrips(
  text: string,
  subStrips: ReadonlyArray<SubStripView>,
  writingMode: WritingMode,
): void {
  const chars = Array.from(text);
  const total = subStrips.length;
  let prevEnd = 0;
  for (let i = 0; i < total; i++) {
    const isLast = i === total - 1;
    const targetEnd = isLast
      ? chars.length
      : Math.round(((i + 1) * chars.length) / total);
    const end = Math.min(chars.length, Math.max(prevEnd, targetEnd));
    const slice = chars.slice(prevEnd, end).join("");
    prevEnd = end;
    const s = subStrips[i];
    renderShowText(s.el, slice, { w: s.width, h: s.height }, writingMode);
  }
}

function firstCandidate(expected: import("./types.js").Expected): string {
  return Array.isArray(expected) ? expected[0] : expected;
}

/** Render the expected text as static SVG so a `mode: "show"` free cell /
 * annotation displays the answer instead of an interactive surface. Each
 * character is dropped into its own slot along the writing axis (top→bottom
 * for vertical-rl, left→right for horizontal-tb) so multi-char answers
 * don't overflow a tall, narrow furigana strip. */
function renderShowText(
  parentEl: HTMLElement,
  text: string,
  rect: { w: number; h: number },
  writingMode: WritingMode,
): void {
  const chars = Array.from(text);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(rect.w));
  svg.setAttribute("height", String(rect.h));
  svg.setAttribute("viewBox", `0 0 ${rect.w} ${rect.h}`);
  svg.style.display = "block";
  if (chars.length === 0) {
    parentEl.appendChild(svg);
    return;
  }
  const isVertical = writingMode === "vertical-rl";
  const slot = (isVertical ? rect.h : rect.w) / chars.length;
  // Cap font-size so a single tall char doesn't blow past the perpendicular
  // axis (otherwise a vertical-rl annotation strip would render furigana
  // glyphs wider than the strip itself).
  const cross = isVertical ? rect.w : rect.h;
  const fontSize = Math.max(8, Math.min(slot, cross) * 0.8);
  for (let i = 0; i < chars.length; i++) {
    const x = isVertical ? rect.w / 2 : (i + 0.5) * slot;
    const y = isVertical ? (i + 0.5) * slot : rect.h / 2;
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "central");
    t.setAttribute("font-size", String(fontSize));
    t.setAttribute("font-family", "serif");
    t.setAttribute("fill", "#222");
    t.textContent = chars[i];
    svg.appendChild(t);
  }
  parentEl.appendChild(svg);
}

/**
 * Draw the cell-centred cross-grid (mid horizontal + mid vertical lines)
 * inside a blank cell wrapper. Mirrors the visual hanzi-writer paints
 * inside guided cells when their `showGrid` is enabled, so blank cells
 * sit visually flush with their guided neighbours.
 */
function drawBlankCrossGrid(
  parentEl: HTMLElement,
  rect: { w: number; h: number },
  span: number,
  writingMode: WritingMode,
  color: string,
  width: number,
  dashArray: string | undefined,
): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(rect.w));
  svg.setAttribute("height", String(rect.h));
  svg.setAttribute("viewBox", `0 0 ${rect.w} ${rect.h}`);
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.pointerEvents = "none";
  svg.style.display = "block";
  // Each grid slot in the span gets its own +.
  const slotSize = (writingMode === "vertical-rl" ? rect.h : rect.w) / span;
  const cross = writingMode === "vertical-rl" ? rect.w : rect.h;
  for (let k = 0; k < span; k++) {
    let cellX: number;
    let cellY: number;
    let cw: number;
    let ch: number;
    if (writingMode === "vertical-rl") {
      cellX = 0;
      cellY = k * slotSize;
      cw = cross;
      ch = slotSize;
    } else {
      cellX = k * slotSize;
      cellY = 0;
      cw = slotSize;
      ch = cross;
    }
    const lines = [
      // horizontal middle
      { x1: cellX, y1: cellY + ch / 2, x2: cellX + cw, y2: cellY + ch / 2 },
      // vertical middle
      { x1: cellX + cw / 2, y1: cellY, x2: cellX + cw / 2, y2: cellY + ch },
    ];
    for (const ln of lines) {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "line");
      el.setAttribute("x1", String(ln.x1));
      el.setAttribute("y1", String(ln.y1));
      el.setAttribute("x2", String(ln.x2));
      el.setAttribute("y2", String(ln.y2));
      el.setAttribute("stroke", color);
      el.setAttribute("stroke-width", String(width));
      if (dashArray) {
        el.setAttribute("stroke-dasharray", dashArray);
      }
      svg.appendChild(el);
    }
  }
  parentEl.appendChild(svg);
}

/** How many cell slots a cell occupies along the main axis. */
function cellSlotSpan(cell: Cell): number {
  if (cell.kind === "free") {
    if (cell.span != null) {
      return cell.span;
    }
    const candidates = Array.isArray(cell.expected) ? cell.expected : [cell.expected];
    return Math.max(...candidates.map((c) => Array.from(c).length));
  }
  if (cell.kind === "blank") {
    return cell.span ?? 1;
  }
  return 1;
}

function validateBlockSpec(
  cells: ReadonlyArray<Cell>,
  annotations: ReadonlyArray<FuriganaAnnotation>,
  writingMode: WritingMode,
): void {
  if (cells.length === 0) {
    // Without cells there is no per-cell completion to await, so
    // onBlockComplete would never fire and the block looks stuck.
    throw new Error("block.create(): spec.cells must contain at least one cell.");
  }
  cells.forEach((cell, i) => {
    if (cell.kind === "blank") {
      if (cell.span !== undefined && (!Number.isInteger(cell.span) || cell.span <= 0)) {
        throw new Error(
          `block.create(): cells[${i}].span must be a positive integer (got ${cell.span}).`,
        );
      }
      return;
    }
    validateMode(cell.mode, `cells[${i}].mode`);
    if (cell.kind === "guided") {
      if (typeof cell.char !== "string" || cell.char.length === 0) {
        throw new Error(
          `block.create(): cells[${i}].char must be a non-empty string (got ${JSON.stringify(cell.char)}).`,
        );
      }
      return;
    }
    validateExpected(cell.expected, `cells[${i}].expected`);
    if (cell.span == null) {
      return;
    }
    if (!Number.isInteger(cell.span) || cell.span <= 0) {
      throw new Error(
        `block.create(): cells[${i}].span must be a positive integer (got ${cell.span}).`,
      );
    }
    const candidates = Array.isArray(cell.expected) ? cell.expected : [cell.expected];
    const longest = Math.max(...candidates.map((c) => Array.from(c).length));
    if (cell.span < longest) {
      throw new Error(
        `block.create(): cells[${i}].span (${cell.span}) is smaller than the longest expected candidate length (${longest}).`,
      );
    }
  });
  annotations.forEach((a, i) => {
    validateMode(a.mode, `annotations[${i}].mode`);
    validateExpected(a.expected, `annotations[${i}].expected`);
    // 0 produces a zero-sized SVG which has no usable interactive surface
    // (and divides by zero in projectClientToCell), so reject 0 as well as
    // negatives / NaN.
    if (a.sizeRatio !== undefined && (!Number.isFinite(a.sizeRatio) || a.sizeRatio <= 0)) {
      throw new Error(
        `block.create(): annotations[${i}].sizeRatio must be a finite positive number (got ${a.sizeRatio}).`,
      );
    }
    const [from, to] = a.cellRange;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to < from ||
      to >= cells.length
    ) {
      throw new Error(
        `block.create(): annotations[${i}].cellRange [${from}, ${to}] is out of range for ${cells.length} cell(s).`,
      );
    }
    // Only top (horizontal-tb) and right (vertical-rl) are positioned correctly
    // by the layout — cells are offset by `annotationThickness` to leave room
    // for those placements only. Other placements would render outside the
    // wrapper so we reject them up front instead of silently mispositioning.
    if (writingMode === "horizontal-tb" && a.placement != null && a.placement !== "top") {
      throw new Error(
        `block.create(): annotations[${i}].placement="${a.placement}" is not supported for writingMode="horizontal-tb" (only "top" is supported in v1).`,
      );
    }
    if (writingMode === "vertical-rl" && a.placement != null && a.placement !== "right") {
      throw new Error(
        `block.create(): annotations[${i}].placement="${a.placement}" is not supported for writingMode="vertical-rl" (only "right" is supported in v1).`,
      );
    }
    // mountAnnotation builds one cellSize-thick sub-strip per covered cell;
    // a span>1 cell would leave the trailing slots uncovered (and the
    // dividers misaligned with the cells/empty strip frames below). v1
    // rejects this up front rather than silently misrendering — annotated
    // cells must be span 1 (guided cells, or free/blank without an
    // explicit span override that exceeds 1).
    for (let k = from; k <= to; k++) {
      const slotSpan = cellSlotSpan(cells[k]);
      if (slotSpan > 1) {
        throw new Error(
          `block.create(): annotations[${i}].cellRange covers cells[${k}] with span=${slotSpan}; annotated cells must have span 1.`,
        );
      }
    }
  });
}

function validateMode(mode: unknown, location: string): void {
  if (mode !== "write" && mode !== "show") {
    throw new Error(
      `block.create(): ${location} must be "write" or "show" (got ${JSON.stringify(mode)}).`,
    );
  }
}

function validateExpected(expected: import("./types.js").Expected, location: string): void {
  if (Array.isArray(expected)) {
    if (expected.length === 0) {
      throw new Error(`block.create(): ${location} must be a non-empty string array.`);
    }
    expected.forEach((s, i) => {
      if (typeof s !== "string" || s.length === 0) {
        throw new Error(
          `block.create(): ${location}[${i}] must be a non-empty string (got ${JSON.stringify(s)}).`,
        );
      }
    });
    return;
  }
  if (typeof expected !== "string" || expected.length === 0) {
    throw new Error(
      `block.create(): ${location} must be a non-empty string (got ${JSON.stringify(expected)}).`,
    );
  }
}

const CREATE_KEYS = new Set<keyof CharCreateOptions>([
  "logger",
  "configLoader",
  "charDataLoader",
  "strokeGroups",
  "leniency",
  "strokeEndingStrictness",
]);

function pickCreateOpts(
  overrides: Partial<CharCreateOptions> & Partial<MountOptions>,
): Partial<CharCreateOptions> {
  const out: Partial<CharCreateOptions> = {};
  for (const k of CREATE_KEYS) {
    if (k in overrides && (overrides as Record<string, unknown>)[k] !== undefined) {
      (out as Record<string, unknown>)[k] = (overrides as Record<string, unknown>)[k];
    }
  }
  return out;
}

function pickMountOpts(
  overrides: Partial<CharCreateOptions> & Partial<MountOptions>,
): Partial<MountOptions> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(overrides)) {
    if (!CREATE_KEYS.has(k as keyof CharCreateOptions)) {
      const v = (overrides as Record<string, unknown>)[k];
      if (v !== undefined) {
        out[k] = v;
      }
    }
  }
  return out as Partial<MountOptions>;
}
