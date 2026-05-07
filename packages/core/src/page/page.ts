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
  /**
   * For show-mode annotations there is no interactive freeCell, so
   * `handle` is a no-op and the synthetic matched result is committed via
   * a microtask. Reset must re-queue that commit, otherwise a reset()
   * after a completed page would clear the result and never restore it.
   */
  emitSynthetic?: () => void;
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
  validateAnnotations(opts.blocks, writingMode);

  // page.create() is the public entrypoint, so rethrow layoutPage's
  // errors under the same prefix the rest of this function uses —
  // callers shouldn't need to know layoutPage exists to read the
  // message.
  let layout;
  try {
    layout = layoutPage(opts.blocks, {
      columns: opts.columns,
      cellsPerColumn: opts.cellsPerColumn,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message.replace(/^layoutPage\(\): /, "page.create(): "), {
      cause: err,
    });
  }

  // Default: every cell on the page gets a paired furigana strip frame
  // sized to fit any block's annotations (or DEFAULT_ANNOTATION_RATIO *
  // cellSize when there are none, so the strip stays visible even if no
  // block carries furigana). Pass `showAnnotationStrip: false` (or
  // `annotationStripThickness: 0`) to turn the strip off page-wide.
  const requiredStrip = blocksRequireStrip(opts.blocks, cellSize);
  const showAnnotationStrip = opts.showAnnotationStrip ?? true;
  let annotationStripThickness: number;
  if (showAnnotationStrip === false) {
    annotationStripThickness = 0;
  } else if (opts.annotationStripThickness !== undefined) {
    annotationStripThickness = opts.annotationStripThickness;
  } else {
    annotationStripThickness = Math.max(requiredStrip, DEFAULT_ANNOTATION_RATIO * cellSize);
  }
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

  // The page renders only the user-supplied blocks. Empty slots between
  // (or after) blocks stay blank — the page draws no chrome of its own,
  // so callers who want practice-book chrome in those gaps must place
  // explicit `kind: "blank"` blocks. Each block reserves an empty
  // furigana-strip frame next to every cell-slot, so the strip column
  // stays visually uniform along the user-supplied blocks.

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

  // An empty page has nothing to commit — fire onPageComplete via a
  // microtask so the lifecycle still resolves deterministically.
  if (blockStates.length === 0) {
    queueMicrotask(() => {
      if (destroyed) {
        return;
      }
      opts.onPageComplete?.({ matched: true, perBlock: [] });
    });
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
        annotationStripThickness,
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
        // Forward the page's showGrid so guided cells inside blocks draw
        // (or hide) their cross-grid in lockstep with the page-level
        // background grid — `page.showGrid` is the single switch.
        showGrid: opts.showGrid ?? true,
        // Pin the strip thickness on every per-segment block so an
        // empty strip frame is reserved alongside each cell, even when
        // the segment's sub-spec carries no annotations.
        annotationThickness: annotationStripThickness,
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
        opts.cellBorderWidth ?? DEFAULT_CELL_BORDER_WIDTH,
        opts.cellBorderColor ?? DEFAULT_CELL_BORDER_COLOR,
        state.blockIndex,
        annotationIndex,
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
        const emitSynthetic = () => {
          queueMicrotask(() => {
            if (destroyed) {
              return;
            }
            slotState.result = stub;
            opts.onCellComplete?.(state.blockIndex, annotationIndex, "annotation", stub);
            maybeCommitBlock(state);
          });
        };
        slotState.emitSynthetic = emitSynthetic;
        state.annotationHandles.push(slotState);
        emitSynthetic();
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
        // Reset the underlying sub-blocks first — block.reset() queues
        // show-mode cell completions in microtasks, so we want those
        // queued ahead of the annotation re-emits below to keep cell
        // callbacks ahead of annotation callbacks (matches the initial
        // create() ordering).
        for (const b of s.segmentBlocks) {
          b.reset();
        }
        for (const h of s.annotationHandles) {
          // Show-mode annotations don't have an interactive handle that
          // re-fires onCellComplete; re-emit the synthetic matched
          // result so block completion can fire again.
          h.emitSynthetic?.();
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

/**
 * Validate every block's annotations up front. Page strips annotations
 * out of the per-segment block.create() calls, so the existing block
 * validation never sees them — without this pass, a malformed cellRange,
 * non-positive sizeRatio, or unsupported placement would either silently
 * misrender or fail later with less actionable errors.
 */
function validateAnnotations(
  blocks: ReadonlyArray<PageBlockEntry>,
  writingMode: WritingMode,
): void {
  const expectedPlacement = writingMode === "vertical-rl" ? "right" : "top";
  blocks.forEach((entry, i) => {
    const cells = entry.spec.cells;
    (entry.spec.annotations ?? []).forEach((a, j) => {
      const at = `blocks[${i}].spec.annotations[${j}]`;
      if (a.mode !== "write" && a.mode !== "show") {
        throw new Error(
          `page.create(): ${at}.mode must be "write" or "show" (got ${JSON.stringify(a.mode)}).`,
        );
      }
      const expected = a.expected;
      if (Array.isArray(expected)) {
        if (expected.length === 0) {
          throw new Error(`page.create(): ${at}.expected must be a non-empty string array.`);
        }
        expected.forEach((s, k) => {
          if (typeof s !== "string" || s.length === 0) {
            throw new Error(
              `page.create(): ${at}.expected[${k}] must be a non-empty string (got ${JSON.stringify(s)}).`,
            );
          }
        });
      } else if (typeof expected !== "string" || expected.length === 0) {
        throw new Error(
          `page.create(): ${at}.expected must be a non-empty string (got ${JSON.stringify(expected)}).`,
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
          `page.create(): ${at}.cellRange [${from}, ${to}] is out of range for ${cells.length} cell(s).`,
        );
      }
      if (a.sizeRatio !== undefined && (!Number.isFinite(a.sizeRatio) || a.sizeRatio <= 0)) {
        throw new Error(
          `page.create(): ${at}.sizeRatio must be a finite positive number (got ${a.sizeRatio}).`,
        );
      }
      if (a.placement != null && a.placement !== expectedPlacement) {
        // page only positions strips on the writingMode-specific side
        // (right of cells in vertical-rl, top of cells in horizontal-tb);
        // any other placement would render outside the reserved strip
        // area, so reject up front rather than silently ignoring it.
        throw new Error(
          `page.create(): ${at}.placement="${a.placement}" is not supported for writingMode="${writingMode}" (only "${expectedPlacement}" aligns with the per-line strip).`,
        );
      }
      // block.mountAnnotation paints one cellSize-thick sub-strip per
      // covered cell, so a cell with slot span > 1 would leave its
      // trailing slots uncovered and dividers misaligned with the empty
      // strip frames below. Reject up front; v1 expects annotations to
      // pair with span-1 cells (guided cells, in practice).
      for (let k = from; k <= to; k++) {
        const slotSpan = annotatedCellSpan(cells[k]);
        if (slotSpan > 1) {
          throw new Error(
            `page.create(): ${at}.cellRange covers blocks[${i}].spec.cells[${k}] with span=${slotSpan}; annotated cells must have span 1.`,
          );
        }
      }
    });
  });
}

function annotatedCellSpan(cell: import("../block/types.js").Cell): number {
  if (cell.kind === "guided") {
    return 1;
  }
  if (cell.kind === "blank") {
    return cell.span ?? 1;
  }
  if (cell.span != null) {
    return cell.span;
  }
  const candidates = Array.isArray(cell.expected) ? cell.expected : [cell.expected];
  return Math.max(...candidates.map((c) => Array.from(c).length));
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
  annotationStripThickness: number;
}

/**
 * Top-left corner of a segment's CELL area on the page (where the
 * sub-block lays out cells starting at its (0, 0)). The annotation strips
 * page builds separately sit on the perpendicular side, anchored to this
 * origin: in vertical-rl they extend right of `origin.x + cellSize`; in
 * horizontal-tb they extend up from `origin.y` into the strip space
 * reserved at the top of the row.
 */
function segmentOrigin(seg: BlockSegment, geo: PageGeometry): { x: number; y: number } {
  if (geo.writingMode === "vertical-rl") {
    const x = geo.pageWidth - (seg.column + 1) * geo.lineThickness;
    const y = seg.cellInColumn * geo.cellSize;
    return { x, y };
  }
  // horizontal-tb: a row's strip space sits ABOVE its cells, so cells of
  // row N start at y = N*lineThickness + stripThickness. Without this
  // offset the first row's annotation would land at a negative y.
  const x = seg.cellInColumn * geo.cellSize;
  const y = seg.column * geo.lineThickness + geo.annotationStripThickness;
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
  cellBorderWidth: number,
  cellBorderColor: string,
  blockIndex: number,
  annotationIndex: number,
): AnnotationSurface[] {
  if (annotationStripThickness <= 0) {
    const [from, to] = annotation.cellRange;
    throw new Error(
      `page.create(): blocks[${blockIndex}].spec.annotations[${annotationIndex}] (cellRange [${from}, ${to}]) requires an annotation strip but annotationStripThickness is 0 (showAnnotationStrip is false?).`,
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
      annotationStripThickness,
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
      stripDiv.style.boxSizing = "border-box";
      // Every per-cell sub-strip draws its own complete border (no
      // edge-hiding between adjacent cells).
      const borderStr = `${cellBorderWidth}px solid ${cellBorderColor}`;
      stripDiv.style.borderTop = borderStr;
      stripDiv.style.borderRight = borderStr;
      stripDiv.style.borderBottom = borderStr;
      stripDiv.style.borderLeft = borderStr;
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
  // Distribute chars proportional to each surface's cell coverage using
  // cumulative rounding. Computing each surface's *end* index from
  // cumulative covered cells (and clamping) keeps the per-surface chunk
  // non-negative even when the reading has fewer chars than cells (more
  // cells than kana in a reading would otherwise let cursor outrun
  // chars.length and the last take drift negative).
  let prevEnd = 0;
  let coveredCells = 0;
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i];
    const span = s.cellTo - s.cellFrom + 1;
    coveredCells += span;
    const isLast = i === surfaces.length - 1;
    const targetEnd = isLast
      ? chars.length
      : Math.round((chars.length * coveredCells) / annLength);
    const end = Math.min(chars.length, Math.max(prevEnd, targetEnd));
    const slice = chars.slice(prevEnd, end).join("");
    prevEnd = end;
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

