import { char, type Char } from "../char.js";
import type {
  CharCreateOptions,
  GridOptions,
  MountOptions,
} from "../charOptions.js";
import { DEFAULT_PADDING, HANZI_COORD_SIZE } from "../constants.js";
import type { CharStrokeData } from "../types.js";
import { createFreeCell, type FreeCellHandle, type FreeCellLogger } from "./freeCell.js";
import type {
  AnnotationResult,
  BlankCell,
  BlankCellResult,
  BlockLoaders,
  BlockResult,
  BlockSpec,
  Cell,
  CellResult,
  FuriganaAnnotation,
  GuidedCell,
  GuidedCellResult,
  FreeCell,
  FreeCellResult,
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
  /** Fired for every cell or annotation completion (matched or failed). */
  onCellComplete?: (
    index: number,
    kind: "cell" | "annotation",
    result: CellResult | AnnotationResult,
  ) => void;
  /** Fired once every cell and annotation has reported a result. */
  onBlockComplete?: (result: BlockResult) => void;
}

export interface Block {
  /** Underlying container element. The block is mounted as its child. */
  el: HTMLElement;
  /** Reset every cell and annotation to a clean writing state. */
  reset(): void;
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
  result: CellResult | null;
  // Resources tied to this cell, depending on kind.
  charInstance?: Char;
  freeHandle?: FreeCellHandle;
  charCellEl?: HTMLDivElement;
  // Cumulative mistake counts for guided cells (mirrors mount flow).
  mistakes?: number;
  strokeEndingMistakes?: number;
}

interface PerAnnotationState {
  index: number;
  annotation: FuriganaAnnotation;
  freeHandle: FreeCellHandle | null;
  result: AnnotationResult | null;
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

  // Compute the annotation strip thickness (max sizeRatio across annotations).
  const annotationThickness = annotations.length === 0
    ? 0
    : Math.max(
        ...annotations.map((a) => (a.sizeRatio ?? DEFAULT_ANNOTATION_RATIO) * cellSize),
      );

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
    // inside guided cells visually match the wrapper border. Explicit
    // `GridOptions` passed by the caller wins.
    const userShowGrid = opts.showGrid ?? true;
    const blockShowGrid: NonNullable<MountOptions["showGrid"]> =
      userShowGrid === true
        ? { color: cellBorderColor, width: cellBorderWidth }
        : userShowGrid;
    // hanzi-writer's `drawingWidth` is interpreted in its internal coord
    // system (HANZI_COORD_SIZE). The character is rendered into the inner
    // padded area, so the display-px → internal-units factor is
    // `HANZI_COORD_SIZE / innerSize` (innerSize = rect.w - 2 * padding).
    // Without accounting for an `overrides.padding`, guided strokes would
    // silently drift thicker than free-cell strokes.
    const resolvedPadding = overrides.padding ?? DEFAULT_PADDING;
    const innerSize = rect.w - 2 * resolvedPadding;
    const guidedDrawingWidth =
      innerSize > 0 ? (resolvedDrawingWidth * HANZI_COORD_SIZE) / innerSize : resolvedDrawingWidth;
    const mountOpts: MountOptions = {
      size: rect.w,
      showGrid: blockShowGrid,
      // Apply the block-wide drawingWidth so guided / free / annotation
      // cells share line thickness by default. Per-cell overrides below
      // (via `pickMountOpts`) still win.
      drawingWidth: guidedDrawingWidth,
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
      result: null,
      charInstance: c,
      charCellEl: cellEl,
      mistakes: 0,
      strokeEndingMistakes: 0,
    };

    if (cell.mode === "write") {
      // Quiz mode: instrument callbacks for mistake counting + completion.
      mountOpts.onCorrectStroke = (data) => handleGuidedStroke(state, "correct", data);
      mountOpts.onMistake = (data) => handleGuidedStroke(state, "mistake", data);
      mountOpts.onStrokeEndingMistake = (data) => handleGuidedStroke(state, "ending-mistake", data);
      mountOpts.onComplete = () => commitGuidedResult(state, true);
      c.mount(cellEl, mountOpts);
      // Kick off the quiz once ready.
      void c.ready().then(() => {
        if (destroyed || !state.charInstance) {
          return;
        }
        c.start();
      });
    } else {
      // Show mode: just render the character — nothing to commit.
      c.mount(cellEl, mountOpts);
      // Show mode is informational; report a synthetic matched=true so the
      // block can still tell when "everything writable is done".
      queueMicrotask(() => {
        if (destroyed) {
          return;
        }
        commitGuidedResult(state, true);
      });
    }
    return state;
  }

  function handleGuidedStroke(
    state: PerCellState,
    kind: "correct" | "mistake" | "ending-mistake",
    _data: CharStrokeData,
  ): void {
    if (kind === "mistake") {
      state.mistakes = (state.mistakes ?? 0) + 1;
    } else if (kind === "ending-mistake") {
      state.strokeEndingMistakes = (state.strokeEndingMistakes ?? 0) + 1;
    }
  }

  function commitGuidedResult(state: PerCellState, matched: boolean): void {
    if (state.result) {
      return;
    }
    const r: GuidedCellResult = {
      kind: "guided",
      matched,
      mistakes: state.mistakes ?? 0,
      strokeEndingMistakes: state.strokeEndingMistakes ?? 0,
    };
    state.result = r;
    opts.onCellComplete?.(state.index, "cell", r);
    maybeCommitBlock();
  }

  function mountFreeCell(
    parentEl: HTMLElement,
    rect: { x: number; y: number; w: number; h: number },
    cell: FreeCell,
    index: number,
  ): PerCellState {
    // Per-cell-slot chrome: each slot in the span gets its own border +
    // cross-grid so a free cell looks like the same row of cells a blank
    // / guided cell would, while the freeCell input layer below treats
    // them as one shared stroke buffer the user can write across.
    const span = cellSlotSpan(cell);
    const slotEls: HTMLDivElement[] = [];
    for (let k = 0; k < span; k++) {
      const slot = document.createElement("div");
      slot.style.position = "absolute";
      let sx: number;
      let sy: number;
      let sw: number;
      let sh: number;
      if (writingMode === "vertical-rl") {
        sx = rect.x;
        sy = rect.y + k * cellSize;
        sw = cellSize;
        sh = cellSize;
      } else {
        sx = rect.x + k * cellSize;
        sy = rect.y;
        sw = cellSize;
        sh = cellSize;
      }
      slot.style.left = `${sx}px`;
      slot.style.top = `${sy}px`;
      slot.style.width = `${sw}px`;
      slot.style.height = `${sh}px`;
      slot.style.boxSizing = "border-box";
      applyBorder(
        slot,
        resolvedCellBorder,
        freeCellSlotEdgesToHide(index, cells.length, k, span, writingMode),
      );
      parentEl.appendChild(slot);
      slotEls.push(slot);
      const userShowGrid = opts.showGrid ?? true;
      if (userShowGrid !== false) {
        const grid = typeof userShowGrid === "object" ? userShowGrid : {};
        const color = grid.color ?? cellBorderColor;
        const width = grid.width ?? cellBorderWidth;
        const dashArray = grid.dashArray ?? "3,3";
        drawBlankCrossGrid(slot, { w: sw, h: sh }, 1, writingMode, color, width, dashArray);
      }
    }

    if (cell.mode === "show") {
      // Render the first candidate as static text spread across the
      // sub-slots so it visually aligns with cell chrome.
      renderShowText(parentEl, firstCandidate(cell.expected), rect, writingMode);
      const state: PerCellState = { index, cell, result: null };
      queueMicrotask(() => {
        if (destroyed) {
          return;
        }
        commitFreeShowResult(state, "cell", cell.expected);
      });
      return state;
    }

    const handle = createFreeCell({
      expected: cell.expected,
      surfaces: slotEls.map((el) => ({
        parent: el,
        width: cellSize,
        height: cellSize,
      })),
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
      onCellComplete: (result: FreeCellResult) => {
        state.result = result;
        opts.onCellComplete?.(index, "cell", result);
        maybeCommitBlock();
      },
    });
    const state: PerCellState = {
      index,
      cell,
      result: null,
      freeHandle: handle,
    };
    return state;
  }

  function commitFreeShowResult(
    state: PerCellState,
    kind: "cell" | "annotation",
    expected: import("./types.js").Expected,
  ): void {
    if (state.result) {
      return;
    }
    const result: FreeCellResult = {
      kind: "free",
      matched: true,
      candidate: firstCandidate(expected),
      similarity: 1,
      perCharacter: [],
    };
    state.result = result;
    opts.onCellComplete?.(state.index, kind, result);
    maybeCommitBlock();
  }

  function mountBlankCell(
    parentEl: HTMLElement,
    rect: { x: number; y: number; w: number; h: number },
    cell: BlankCell,
    index: number,
  ): PerCellState {
    const wrapperEl = document.createElement("div");
    wrapperEl.style.position = "absolute";
    wrapperEl.style.left = `${rect.x}px`;
    wrapperEl.style.top = `${rect.y}px`;
    wrapperEl.style.width = `${rect.w}px`;
    wrapperEl.style.height = `${rect.h}px`;
    wrapperEl.style.boxSizing = "border-box";
    applyBorder(wrapperEl, resolvedCellBorder, cellEdgesToHide(index, cells.length, writingMode));
    parentEl.appendChild(wrapperEl);
    // Optional cross-grid (matches the guided cell cross-grid drawn by
    // hanzi-writer when block.showGrid is enabled). Each grid slot in the
    // span gets its own +. Dashes by default so the placement guide
    // reads visually distinct from the solid cell border.
    const userShowGrid = opts.showGrid ?? true;
    if (userShowGrid !== false) {
      const grid = (typeof userShowGrid === "object" ? userShowGrid : {});
      const color = grid.color ?? cellBorderColor;
      const width = grid.width ?? cellBorderWidth;
      const dashArray = grid.dashArray ?? "3,3";
      const span = cellSlotSpan(cell);
      drawBlankCrossGrid(wrapperEl, rect, span, writingMode, color, width, dashArray);
    }
    const state: PerCellState = { index, cell, result: null };
    queueMicrotask(() => {
      if (destroyed) {
        return;
      }
      commitBlankResult(state);
    });
    return state;
  }

  function commitBlankResult(state: PerCellState): void {
    if (state.result) {
      return;
    }
    const result: BlankCellResult = { kind: "blank", matched: true };
    state.result = result;
    opts.onCellComplete?.(state.index, "cell", result);
    maybeCommitBlock();
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
      applyBorder(
        sub,
        resolvedCellBorder,
        annotationSubStripEdgesToHide(annotation, writingMode, k, cellCount),
      );
      parentEl.appendChild(sub);
      subStrips.push({ el: sub, width: sw, height: sh, cellIndex: annFrom + k });
    }

    if (annotation.mode === "show") {
      renderShowAcrossSubStrips(
        firstCandidate(annotation.expected),
        subStrips,
        writingMode,
      );
      const state: PerAnnotationState = { index, annotation, result: null, freeHandle: null };
      queueMicrotask(() => {
        if (destroyed) {
          return;
        }
        commitAnnotationShowResult(state);
      });
      return state;
    }

    const state: PerAnnotationState = {
      index,
      annotation,
      result: null,
      freeHandle: createFreeCell({
        expected: annotation.expected,
        surfaces: subStrips.map((s) => ({ parent: s.el, width: s.width, height: s.height })),
        label: `annotation#${index}`,
        ...(opts.drawingColor ? { drawingColor: opts.drawingColor } : {}),
        ...(opts.matchedColor ? { matchedColor: opts.matchedColor } : {}),
        ...(opts.failedColor ? { failedColor: opts.failedColor } : {}),
        drawingWidth: opts.annotationDrawingWidth ?? resolvedDrawingWidth,
        ...(opts.loaders ? { loaders: opts.loaders } : {}),
        ...(opts.logger ? { logger: opts.logger } : {}),
        ...(opts.showSegmentBoxes !== undefined ? { showSegmentBoxes: opts.showSegmentBoxes } : {}),
        ...(opts.segmentBoxColor ? { segmentBoxColor: opts.segmentBoxColor } : {}),
        ...(opts.freeCellLeniency !== undefined ? { leniency: opts.freeCellLeniency } : {}),
        onCellComplete: (result: FreeCellResult) => {
          state.result = result;
          opts.onCellComplete?.(index, "annotation", result);
          maybeCommitBlock();
        },
      }),
    };
    return state;
  }

  function commitAnnotationShowResult(state: PerAnnotationState): void {
    if (state.result) {
      return;
    }
    const result: FreeCellResult = {
      kind: "free",
      matched: true,
      candidate: firstCandidate(state.annotation.expected),
      similarity: 1,
      perCharacter: [],
    };
    state.result = result;
    opts.onCellComplete?.(state.index, "annotation", result);
    maybeCommitBlock();
  }

  function maybeCommitBlock(): void {
    const allCellResults = cellStates.every((s) => s.result !== null);
    const allAnnotationResults = annotationStates.every((s) => s.result !== null);
    if (!allCellResults || !allAnnotationResults) {
      return;
    }
    const perCell = cellStates.map((s) => s.result!);
    const perAnnotation = annotationStates.map((s) => s.result!);
    const matched = perCell.every((r) => r.matched) && perAnnotation.every((r) => r.matched);
    opts.onBlockComplete?.({ matched, perCell, perAnnotation });
  }

  return {
    el: wrapper,
    reset(): void {
      if (destroyed) {
        return;
      }
      for (const state of cellStates) {
        state.result = null;
        state.mistakes = 0;
        state.strokeEndingMistakes = 0;
        if (state.cell.kind === "guided" && state.charInstance && state.charCellEl) {
          state.charInstance.reset();
          if (state.cell.mode === "write") {
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
              commitGuidedResult(state, true);
            });
          }
        } else if (state.freeHandle) {
          state.freeHandle.reset();
        } else if (state.cell.kind === "free" && state.cell.mode === "show") {
          // mode='show' free cell — re-emit the synthetic matched result.
          const expected = state.cell.expected;
          queueMicrotask(() => {
            if (destroyed) {
              return;
            }
            commitFreeShowResult(state, "cell", expected);
          });
        } else if (state.cell.kind === "blank") {
          // Blank cells are visual-only; re-emit the synthetic matched
          // result so block aggregation completes again.
          queueMicrotask(() => {
            if (destroyed) {
              return;
            }
            commitBlankResult(state);
          });
        }
      }
      for (const state of annotationStates) {
        state.result = null;
        if (state.freeHandle) {
          state.freeHandle.reset();
        } else {
          // mode='show' annotation — re-emit the synthetic result.
          queueMicrotask(() => {
            if (destroyed) {
              return;
            }
            commitAnnotationShowResult(state);
          });
        }
      }
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

/** Hide the edge a cell shares with the next cell so the neighbour's own
 * border draws the shared line — avoids the doubled-up 2px appearance.
 * Annotations handle their own touching edge in `annotationEdgesToHide`. */
function cellEdgesToHide(
  index: number,
  total: number,
  writingMode: WritingMode,
): BorderHide {
  const hide: BorderHide = { ...NO_HIDE };
  const isLast = index === total - 1;
  if (writingMode === "horizontal-tb" && !isLast) {
    hide.right = true;
  } else if (writingMode === "vertical-rl" && !isLast) {
    hide.bottom = true;
  }
  return hide;
}

/** A free cell expanded into per-slot sub-cells hides the edge each
 * sub-cell shares with its neighbour (so the next slot's own border
 * draws the shared line) while keeping the outer block-cell hides
 * inherited from cellEdgesToHide. */
function freeCellSlotEdgesToHide(
  cellIndex: number,
  cellTotal: number,
  slotIndex: number,
  slotTotal: number,
  writingMode: WritingMode,
): BorderHide {
  const hide: BorderHide = { ...cellEdgesToHide(cellIndex, cellTotal, writingMode) };
  const isLastSlot = slotIndex === slotTotal - 1;
  if (writingMode === "vertical-rl") {
    if (!isLastSlot) {
      hide.bottom = true;
    }
  } else {
    if (!isLastSlot) {
      hide.right = true;
    }
  }
  return hide;
}

/** Hide the annotation's edge that touches the covered cells so only one
 * 1px line shows on the shared boundary. */
function annotationEdgesToHide(
  annotation: FuriganaAnnotation,
  writingMode: WritingMode,
): BorderHide {
  const hide: BorderHide = { ...NO_HIDE };
  if (writingMode === "vertical-rl") {
    const placement = annotation.placement ?? "right";
    if (placement === "right") {
      hide.left = true;
    } else if (placement === "left") {
      hide.right = true;
    }
  } else {
    const placement = annotation.placement ?? "top";
    if (placement === "top") {
      hide.bottom = true;
    } else if (placement === "bottom") {
      hide.top = true;
    }
  }
  return hide;
}

/** Like {@link annotationEdgesToHide} but for one of the per-cell sub-strips
 * that make up the annotation. The strip-cells share an edge with each
 * other (hide it on every non-last sub) and the outer-edge facing the
 * underlying cells is hidden to merge with the cell border. */
function annotationSubStripEdgesToHide(
  annotation: FuriganaAnnotation,
  writingMode: WritingMode,
  index: number,
  total: number,
): BorderHide {
  const hide: BorderHide = { ...annotationEdgesToHide(annotation, writingMode) };
  const isLast = index === total - 1;
  if (writingMode === "vertical-rl" && !isLast) {
    hide.bottom = true;
  } else if (writingMode === "horizontal-tb" && !isLast) {
    hide.right = true;
  }
  return hide;
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
