import {
  block,
  type AnnotationResult,
  type Block,
  type BlockCreateOptions,
  type BlockResult,
  type BlockSpec,
  type CellResult,
  type FreeCellResult,
  type FuriganaAnnotation,
  type WritingMode,
} from "../block/index.js";
import { createFreeCell, type FreeCellHandle } from "../block/freeCell.js";
import { layoutPage, type BlockSegment } from "./layout.js";
import type {
  Page,
  PageBlockEntry,
  PageBlockResult,
  PageCreateOptions,
} from "./types.js";

const DEFAULT_ANNOTATION_RATIO = 0.4;
const DEFAULT_CELL_BORDER_WIDTH = 1;
const DEFAULT_CELL_BORDER_COLOR = "#ddd";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * `page` namespace — `page.create()` lays out a grid of `Block`s on a single
 * page surface (vertical-rl by default), flowing them from the top of one
 * column to the next. Blocks without annotations split at column
 * boundaries; annotated blocks split too, with the annotation rendered
 * across multiple strip surfaces that share a single stroke buffer (so the
 * user can write the furigana in either segment, character-aligned).
 */
export const page = {
  create(target: HTMLElement | string, opts: PageCreateOptions): Page {
    const container = resolveTarget(target);
    return createPage(container, opts);
  },
};

function resolveTarget(target: HTMLElement | string): HTMLElement {
  if (typeof target === "string") {
    const found = document.querySelector(target);
    if (!found) {
      throw new Error(`page.create(): selector "${target}" did not match any element.`);
    }
    return found as HTMLElement;
  }
  return target;
}

interface AnnotationHandleState {
  annotationIndex: number;
  handle: FreeCellHandle;
  result: AnnotationResult | null;
}

interface PerBlockState {
  blockIndex: number;
  id?: string;
  spec: BlockSpec;
  /** Sub-blocks placed for each segment of cells. */
  segmentBlocks: Block[];
  /** Multi-surface freeCells for each original annotation. */
  annotationHandles: AnnotationHandleState[];
  /** Per-cell results aligned to original spec.cells indices. */
  cellResults: Array<CellResult | null>;
  done: boolean;
  result: BlockResult | null;
}

function createPage(parent: HTMLElement, opts: PageCreateOptions): Page {
  const cellSize = opts.cellSize;
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(
      `page.create(): cellSize must be a finite positive number (got ${cellSize}).`,
    );
  }
  const writingMode: WritingMode = opts.writingMode ?? "vertical-rl";
  if (writingMode !== "vertical-rl" && writingMode !== "horizontal-tb") {
    throw new Error(
      `page.create(): writingMode must be "vertical-rl" or "horizontal-tb" (got ${JSON.stringify(writingMode)}).`,
    );
  }

  const layout = layoutPage(opts.blocks, {
    columns: opts.columns,
    cellsPerColumn: opts.cellsPerColumn,
  });

  const requiredStrip = blocksRequireStrip(opts.blocks, cellSize);
  const annotationStripThickness =
    opts.annotationStripThickness ?? requiredStrip;
  if (
    !Number.isFinite(annotationStripThickness) ||
    annotationStripThickness < 0
  ) {
    throw new Error(
      `page.create(): annotationStripThickness must be a finite non-negative number (got ${annotationStripThickness}).`,
    );
  }
  if (annotationStripThickness < requiredStrip) {
    throw new Error(
      `page.create(): annotationStripThickness=${annotationStripThickness} is smaller than the largest block annotation thickness (${requiredStrip}).`,
    );
  }
  const lineThickness = cellSize + annotationStripThickness;

  const pageWidth =
    writingMode === "vertical-rl"
      ? opts.columns * lineThickness
      : opts.cellsPerColumn * cellSize;
  const pageHeight =
    writingMode === "vertical-rl"
      ? opts.cellsPerColumn * cellSize
      : opts.columns * lineThickness;

  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-block";
  wrapper.style.lineHeight = "0";
  wrapper.style.width = `${pageWidth}px`;
  wrapper.style.height = `${pageHeight}px`;
  parent.appendChild(wrapper);

  const showGrid = opts.showGrid ?? true;
  if (showGrid !== false) {
    drawGrid(wrapper, {
      pageWidth,
      pageHeight,
      cellSize,
      lineThickness,
      columns: opts.columns,
      cellsPerColumn: opts.cellsPerColumn,
      writingMode,
      color:
        (typeof showGrid === "object" && showGrid.color) ||
        opts.cellBorderColor ||
        DEFAULT_CELL_BORDER_COLOR,
      width:
        (typeof showGrid === "object" && showGrid.width) ||
        opts.cellBorderWidth ||
        DEFAULT_CELL_BORDER_WIDTH,
    });
  }

  let destroyed = false;
  const blockStates: PerBlockState[] = opts.blocks.map((entry, i) => {
    const id = entry.id;
    return {
      blockIndex: i,
      ...(id !== undefined ? { id } : {}),
      spec: entry.spec,
      segmentBlocks: [],
      annotationHandles: [],
      cellResults: entry.spec.cells.map(() => null),
      done: false,
      result: null,
    };
  });

  // Group segments by blockIndex.
  const segmentsByBlock = new Map<number, BlockSegment[]>();
  for (const seg of layout.segments) {
    const list = segmentsByBlock.get(seg.blockIndex) ?? [];
    list.push(seg);
    segmentsByBlock.set(seg.blockIndex, list);
  }

  for (const [blockIndex, segments] of segmentsByBlock) {
    const entry = opts.blocks[blockIndex];
    const state = blockStates[blockIndex];
    placeBlock(state, entry, segments);
  }

  function placeBlock(
    state: PerBlockState,
    entry: PageBlockEntry,
    segments: BlockSegment[],
  ): void {
    // 1. Render cells per segment (each as its own block.create with a
    // sub-spec). Sub-specs carry no annotations — annotations are handled
    // separately so multi-segment blocks share one stroke buffer per
    // annotation across surfaces.
    for (const seg of segments) {
      const slotEl = document.createElement("div");
      slotEl.style.position = "absolute";
      const origin = segmentOrigin(seg, {
        cellSize,
        lineThickness,
        pageWidth,
        writingMode,
      });
      slotEl.style.left = `${origin.x}px`;
      slotEl.style.top = `${origin.y}px`;
      // Place a sub-wrapper that is exactly cellSize wide so the block's
      // own layout (no annotation in sub-spec) sits at the cell side of
      // the strip.
      wrapper.appendChild(slotEl);

      const subSpec: BlockSpec = {
        cells: entry.spec.cells.slice(seg.cellFrom, seg.cellTo + 1),
      };
      const blockOpts: BlockCreateOptions = {
        spec: subSpec,
        cellSize,
        writingMode,
        ...(opts.loaders ? { loaders: opts.loaders } : {}),
        ...(opts.drawingColor ? { drawingColor: opts.drawingColor } : {}),
        ...(opts.matchedColor ? { matchedColor: opts.matchedColor } : {}),
        ...(opts.failedColor ? { failedColor: opts.failedColor } : {}),
        ...(opts.drawingWidth !== undefined ? { drawingWidth: opts.drawingWidth } : {}),
        ...(opts.cellBorderWidth !== undefined ? { cellBorderWidth: opts.cellBorderWidth } : {}),
        ...(opts.cellBorderColor ? { cellBorderColor: opts.cellBorderColor } : {}),
        ...(opts.freeCellLeniency !== undefined ? { freeCellLeniency: opts.freeCellLeniency } : {}),
        ...(opts.logger ? { logger: opts.logger } : {}),
        ...(opts.showSegmentBoxes !== undefined ? { showSegmentBoxes: opts.showSegmentBoxes } : {}),
        ...(opts.segmentBoxColor ? { segmentBoxColor: opts.segmentBoxColor } : {}),
        // Page draws its own grid; suppress per-block grid overlays.
        showGrid: false,
        onCellComplete: (subIndex, kind, result) => {
          // Translate sub-spec cell index back to original block cell index.
          const origIndex = seg.cellFrom + subIndex;
          if (kind === "cell") {
            state.cellResults[origIndex] = result as CellResult;
          }
          opts.onCellComplete?.(state.blockIndex, origIndex, kind, result);
          maybeCommitBlock(state);
        },
      };
      const b = block.create(slotEl, blockOpts);
      state.segmentBlocks.push(b);
    }

    // 2. Render annotations. Each annotation may span one or more
    // segments. Build a list of surfaces (one strip per segment that the
    // annotation's cellRange intersects) and create a single freeCell with
    // those surfaces — they share a stroke buffer so the user can write
    // the answer freely across segments at character boundaries.
    const annotations = entry.spec.annotations ?? [];
    annotations.forEach((annotation, annotationIndex) => {
      const surfaces = annotationSurfaces(
        wrapper,
        annotation,
        segments,
        cellSize,
        annotationStripThickness,
        lineThickness,
        pageWidth,
        writingMode,
      );
      if (annotation.mode === "show") {
        // Split show-mode renders the expected text vertically (or
        // horizontally) across surfaces, distributing chars proportional
        // to each surface's cell coverage.
        renderShowAnnotation(annotation, surfaces, writingMode);
        const stub: FreeCellResult = {
          kind: "free",
          matched: true,
          candidate: firstCandidate(annotation.expected),
          similarity: 1,
          perCharacter: [],
        };
        const slotState: AnnotationHandleState = {
          annotationIndex,
          // No interactive handle for show mode; we still need an entry so
          // result aggregation knows to expect this annotation.
          handle: noopHandle(),
          result: null,
        };
        state.annotationHandles.push(slotState);
        queueMicrotask(() => {
          if (destroyed) {
            return;
          }
          slotState.result = stub;
          opts.onCellComplete?.(state.blockIndex, annotationIndex, "annotation", stub);
          maybeCommitBlock(state);
        });
        return;
      }
      const handle = createFreeCell({
        expected: annotation.expected,
        surfaces: surfaces.map((s) => ({
          parent: s.el,
          width: s.width,
          height: s.height,
        })),
        label: `block#${state.blockIndex}/annotation#${annotationIndex}`,
        ...(opts.drawingColor ? { drawingColor: opts.drawingColor } : {}),
        ...(opts.matchedColor ? { matchedColor: opts.matchedColor } : {}),
        ...(opts.failedColor ? { failedColor: opts.failedColor } : {}),
        drawingWidth: opts.annotationDrawingWidth ?? opts.drawingWidth ?? 4,
        ...(opts.loaders ? { loaders: opts.loaders } : {}),
        ...(opts.logger ? { logger: opts.logger } : {}),
        ...(opts.freeCellLeniency !== undefined ? { leniency: opts.freeCellLeniency } : {}),
        onCellComplete: (result) => {
          slotState.result = result;
          opts.onCellComplete?.(state.blockIndex, annotationIndex, "annotation", result);
          maybeCommitBlock(state);
        },
      });
      const slotState: AnnotationHandleState = {
        annotationIndex,
        handle,
        result: null,
      };
      state.annotationHandles.push(slotState);
    });
  }

  function maybeCommitBlock(state: PerBlockState): void {
    if (destroyed || state.done) {
      return;
    }
    if (state.cellResults.some((r) => r === null)) {
      return;
    }
    if (state.annotationHandles.some((h) => h.result === null)) {
      return;
    }
    const perCell = state.cellResults.map((r) => r!);
    const perAnnotation = state.annotationHandles.map((h) => h.result!);
    const matched =
      perCell.every((r) => r.matched) && perAnnotation.every((r) => r.matched);
    const result: BlockResult = { matched, perCell, perAnnotation };
    state.result = result;
    state.done = true;
    opts.onBlockComplete?.(state.blockIndex, result);
    maybeCommitPage();
  }

  function maybeCommitPage(): void {
    if (destroyed) {
      return;
    }
    if (blockStates.some((s) => s.result === null)) {
      return;
    }
    const perBlock: PageBlockResult[] = blockStates.map((s) => ({
      blockIndex: s.blockIndex,
      ...(s.id !== undefined ? { id: s.id } : {}),
      result: s.result!,
    }));
    const matched = perBlock.every((b) => b.result.matched);
    opts.onPageComplete?.({ matched, perBlock });
  }

  return {
    el: wrapper,
    reset(): void {
      if (destroyed) {
        return;
      }
      for (const s of blockStates) {
        for (let i = 0; i < s.cellResults.length; i++) {
          s.cellResults[i] = null;
        }
        for (const h of s.annotationHandles) {
          h.result = null;
          h.handle.reset();
        }
        for (const b of s.segmentBlocks) {
          b.reset();
        }
        s.done = false;
        s.result = null;
      }
    },
    destroy(): void {
      destroyed = true;
      for (const s of blockStates) {
        for (const b of s.segmentBlocks) {
          b.destroy();
        }
        for (const h of s.annotationHandles) {
          h.handle.destroy();
        }
      }
      if (wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
    },
  };
}

function noopHandle(): FreeCellHandle {
  return {
    els: [],
    reset(): void {},
    destroy(): void {},
  };
}

function blocksRequireStrip(
  blocks: ReadonlyArray<PageBlockEntry>,
  cellSize: number,
): number {
  let max = 0;
  for (const entry of blocks) {
    for (const a of entry.spec.annotations ?? []) {
      const ratio = a.sizeRatio ?? DEFAULT_ANNOTATION_RATIO;
      const t = ratio * cellSize;
      if (t > max) {
        max = t;
      }
    }
  }
  return max;
}

interface PageGeometry {
  cellSize: number;
  lineThickness: number;
  pageWidth: number;
  writingMode: WritingMode;
}

/**
 * Top-left corner of a segment slot. The block.create that follows lays
 * cells out at (0, 0) of this slot (cell side of the line strip); the
 * annotation strips that page builds separately sit on the perpendicular
 * side beyond cellSize.
 */
function segmentOrigin(seg: BlockSegment, geo: PageGeometry): { x: number; y: number } {
  if (geo.writingMode === "vertical-rl") {
    const x = geo.pageWidth - (seg.column + 1) * geo.lineThickness;
    const y = seg.cellInColumn * geo.cellSize;
    return { x, y };
  }
  const x = seg.cellInColumn * geo.cellSize;
  const y = seg.column * geo.lineThickness;
  return { x, y };
}

interface AnnotationSurface {
  el: HTMLDivElement;
  width: number;
  height: number;
  /** First original cell index of this surface's portion of the annotation. */
  cellFrom: number;
  /** Last original cell index of this surface's portion. */
  cellTo: number;
}

function annotationSurfaces(
  wrapper: HTMLElement,
  annotation: FuriganaAnnotation,
  segments: ReadonlyArray<BlockSegment>,
  cellSize: number,
  annotationStripThickness: number,
  lineThickness: number,
  pageWidth: number,
  writingMode: WritingMode,
): AnnotationSurface[] {
  if (annotationStripThickness <= 0) {
    throw new Error(
      `page.create(): block has annotations but annotationStripThickness is 0.`,
    );
  }
  const [annFrom, annTo] = annotation.cellRange;
  // One surface per overlapping cell so the strip dividers line up with
  // the cells underneath — same pattern block.ts uses inside a single
  // column. The freeCell still treats them as a single judging unit
  // (shared stroke buffer).
  const surfaces: AnnotationSurface[] = [];
  for (const seg of segments) {
    const overlapFrom = Math.max(annFrom, seg.cellFrom);
    const overlapTo = Math.min(annTo, seg.cellTo);
    if (overlapFrom > overlapTo) {
      continue;
    }
    const segOrigin = segmentOrigin(seg, {
      cellSize,
      lineThickness,
      pageWidth,
      writingMode,
    });
    for (let cell = overlapFrom; cell <= overlapTo; cell++) {
      const localOffset = cell - seg.cellFrom;
      const stripDiv = document.createElement("div");
      stripDiv.style.position = "absolute";
      let width: number;
      let height: number;
      if (writingMode === "vertical-rl") {
        stripDiv.style.left = `${segOrigin.x + cellSize}px`;
        stripDiv.style.top = `${segOrigin.y + localOffset * cellSize}px`;
        width = annotationStripThickness;
        height = cellSize;
      } else {
        stripDiv.style.left = `${segOrigin.x + localOffset * cellSize}px`;
        stripDiv.style.top = `${segOrigin.y - annotationStripThickness}px`;
        width = cellSize;
        height = annotationStripThickness;
      }
      stripDiv.style.width = `${width}px`;
      stripDiv.style.height = `${height}px`;
      wrapper.appendChild(stripDiv);
      surfaces.push({
        el: stripDiv,
        width,
        height,
        cellFrom: cell,
        cellTo: cell,
      });
    }
  }
  return surfaces;
}

function renderShowAnnotation(
  annotation: FuriganaAnnotation,
  surfaces: ReadonlyArray<AnnotationSurface>,
  writingMode: WritingMode,
): void {
  const text = firstCandidate(annotation.expected);
  const chars = Array.from(text);
  const annLength = annotation.cellRange[1] - annotation.cellRange[0] + 1;
  // Distribute chars proportional to each surface's cell coverage. When
  // the distribution doesn't divide evenly, the trailing surfaces get the
  // overflow chars (small visual quirk vs throwing for misaligned reads).
  let cursor = 0;
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i];
    const span = s.cellTo - s.cellFrom + 1;
    const isLast = i === surfaces.length - 1;
    const take = isLast
      ? chars.length - cursor
      : Math.round((chars.length * span) / annLength);
    const slice = chars.slice(cursor, cursor + take).join("");
    cursor += take;
    appendShowSvg(s, slice, writingMode);
  }
}

function appendShowSvg(
  s: AnnotationSurface,
  text: string,
  writingMode: WritingMode,
): void {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(s.width));
  svg.setAttribute("height", String(s.height));
  svg.setAttribute("viewBox", `0 0 ${s.width} ${s.height}`);
  svg.style.display = "block";
  svg.style.pointerEvents = "none";
  const chars = Array.from(text);
  if (chars.length === 0) {
    s.el.appendChild(svg);
    return;
  }
  const isVertical = writingMode === "vertical-rl";
  const slot = (isVertical ? s.height : s.width) / chars.length;
  const cross = isVertical ? s.width : s.height;
  const fontSize = Math.max(8, Math.min(slot, cross) * 0.8);
  for (let i = 0; i < chars.length; i++) {
    const x = isVertical ? s.width / 2 : (i + 0.5) * slot;
    const y = isVertical ? (i + 0.5) * slot : s.height / 2;
    const t = document.createElementNS(SVG_NS, "text");
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
  s.el.appendChild(svg);
}

function firstCandidate(expected: import("../block/types.js").Expected): string {
  return Array.isArray(expected) ? expected[0] : expected;
}

interface GridDrawOptions {
  pageWidth: number;
  pageHeight: number;
  cellSize: number;
  lineThickness: number;
  columns: number;
  cellsPerColumn: number;
  writingMode: WritingMode;
  color: string;
  width: number;
}

/**
 * Faint guide grid for empty cells. Block borders cover the grid where
 * blocks are mounted, so the grid only "shows through" in unfilled slots
 * — same visual you'd see in a blank 練習帳 page.
 */
function drawGrid(parent: HTMLElement, opts: GridDrawOptions): void {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(opts.pageWidth));
  svg.setAttribute("height", String(opts.pageHeight));
  svg.setAttribute("viewBox", `0 0 ${opts.pageWidth} ${opts.pageHeight}`);
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.pointerEvents = "none";
  svg.style.display = "block";

  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  if (opts.writingMode === "vertical-rl") {
    for (let c = 0; c <= opts.cellsPerColumn; c++) {
      const y = c * opts.cellSize;
      lines.push({ x1: 0, y1: y, x2: opts.pageWidth, y2: y });
    }
    for (let l = 0; l <= opts.columns; l++) {
      const xStrip = opts.pageWidth - l * opts.lineThickness;
      lines.push({ x1: xStrip, y1: 0, x2: xStrip, y2: opts.pageHeight });
      if (opts.lineThickness > opts.cellSize && l < opts.columns) {
        const xCell = xStrip - opts.lineThickness + opts.cellSize;
        lines.push({ x1: xCell, y1: 0, x2: xCell, y2: opts.pageHeight });
      }
    }
  } else {
    for (let c = 0; c <= opts.cellsPerColumn; c++) {
      const x = c * opts.cellSize;
      lines.push({ x1: x, y1: 0, x2: x, y2: opts.pageHeight });
    }
    for (let l = 0; l <= opts.columns; l++) {
      const yStrip = l * opts.lineThickness;
      lines.push({ x1: 0, y1: yStrip, x2: opts.pageWidth, y2: yStrip });
      if (opts.lineThickness > opts.cellSize && l < opts.columns) {
        const yCell = yStrip + opts.lineThickness - opts.cellSize;
        lines.push({ x1: 0, y1: yCell, x2: opts.pageWidth, y2: yCell });
      }
    }
  }

  for (const ln of lines) {
    const el = document.createElementNS(SVG_NS, "line");
    el.setAttribute("x1", String(ln.x1));
    el.setAttribute("y1", String(ln.y1));
    el.setAttribute("x2", String(ln.x2));
    el.setAttribute("y2", String(ln.y2));
    el.setAttribute("stroke", opts.color);
    el.setAttribute("stroke-width", String(opts.width));
    svg.appendChild(el);
  }
  parent.appendChild(svg);
}
