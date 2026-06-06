import {
  DEFAULT_DRAWING_WIDTH,
  DEFAULT_PADDING,
  HANZI_PRESCALED_SIZE,
  HANZI_Y_BASELINE_OFFSET,
} from "./constants.js";
import { drawCrossGrid } from "./char.js";
import { defaultCharDataLoader } from "./dataLoader.js";
import type {
  CharDataLoaderFn,
  CharResult,
  CharStrokeResult,
  RestoreOptions,
} from "./charOptions.js";
import type { TimedPoint } from "./types.js";
import type {
  BlockCellResult,
  BlockResult,
  BlockRestoreOptions,
  BlockSpec,
  Cell,
} from "./block/types.js";
import type { PageResult, PageRestoreOptions } from "./page/types.js";
import { layoutPage } from "./page/layout.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const RESTORE_SVG_CLASS = "kakitori-restore-svg";
const BLOCK_RESTORE_CLASS = "kakitori-block-restore";
const PAGE_RESTORE_CLASS = "kakitori-page-restore";

const DEFAULT_REFERENCE_COLOR = "#555";
const DEFAULT_DRAWING_COLOR = "#222";
const DEFAULT_CELL_BORDER_WIDTH = 1;
const DEFAULT_CELL_BORDER_COLOR = "#bbb";

/** Loose validation matching the one used in `Char.mount` / `char.render`. */
function validateSizeAndPadding(
  size: number,
  padding: number,
  context: string,
): void {
  if (!Number.isFinite(size)) {
    throw new Error(`${context}: size must be finite, got ${size}`);
  }
  if (size <= 0) {
    throw new Error(`${context}: size must be positive, got ${size}`);
  }
  if (!Number.isFinite(padding)) {
    throw new Error(`${context}: padding must be finite, got ${padding}`);
  }
  if (padding < 0) {
    throw new Error(`${context}: padding must be non-negative, got ${padding}`);
  }
  if (padding >= size / 2) {
    throw new Error(
      `${context}: padding (${padding}) must be less than size/2 (${size / 2})`,
    );
  }
}

function resolveTarget(target: string | HTMLElement, context: string): HTMLElement {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) {
    throw new Error(`${context}: target selector "${target}" did not match any element.`);
  }
  return el as HTMLElement;
}

/**
 * Construct a fresh cell SVG sized `size × size` with the standard
 * hanzi-writer projection applied to its inner `<g>`. The returned
 * `group` lives in hanzi-writer internal coords (Y-up,
 * `x ∈ [0, HANZI_PRESCALED_SIZE]`, `y ∈ [HANZI_Y_MIN, HANZI_Y_MAX]`),
 * so callers can append the reference character paths and user
 * polylines directly without re-projecting.
 */
function buildCellChrome(
  size: number,
  padding: number,
  showGrid: RestoreOptions["showGrid"],
): { svg: SVGSVGElement; group: SVGGElement } {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.classList.add(RESTORE_SVG_CLASS);
  if (showGrid !== false && showGrid !== undefined) {
    drawCrossGrid(svg, size, showGrid === true || showGrid === undefined ? true : showGrid);
  }
  const scale = (size - 2 * padding) / HANZI_PRESCALED_SIZE;
  const group = document.createElementNS(SVG_NS, "g") as SVGGElement;
  // Same transform as `char.render`: flip Y around the baseline and
  // shift down by the descender offset so internal y=900 lands at
  // `padding` and y=-124 lands at `size - padding`.
  group.setAttribute(
    "transform",
    `translate(${padding}, ${size - padding - HANZI_Y_BASELINE_OFFSET * scale}) scale(${scale}, ${-scale})`,
  );
  svg.appendChild(group);
  return { svg, group };
}

function appendCharacterPaths(
  group: SVGGElement,
  strokes: ReadonlyArray<string>,
  color: string,
): void {
  for (const d of strokes) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", color);
    group.appendChild(path);
  }
}

/**
 * Append one polyline per stored stroke into `group`. Points are in
 * internal coords, so the parent `<g>`'s transform handles the
 * projection. `vector-effect="non-scaling-stroke"` keeps the
 * `stroke-width` interpretation in display pixels regardless of the
 * scaled context.
 */
function appendUserPolylines(
  group: SVGGElement,
  perStroke: ReadonlyArray<CharStrokeResult>,
  drawingWidth: number,
  okColor: string,
  ngColor: string,
): void {
  for (const stroke of perStroke) {
    const pts = stroke.points;
    if (!pts || pts.length < 2) {
      continue;
    }
    const ptsStr = serializePoints(pts);
    const polyline = document.createElementNS(SVG_NS, "polyline");
    polyline.setAttribute("points", ptsStr);
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", stroke.matched ? okColor : ngColor);
    polyline.setAttribute("stroke-width", String(drawingWidth));
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    polyline.setAttribute("vector-effect", "non-scaling-stroke");
    group.appendChild(polyline);
  }
}

function serializePoints(points: ReadonlyArray<TimedPoint>): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/** Remove any previous restore-owned SVGs from the target. */
function clearPriorRestoreSvg(target: HTMLElement): void {
  target
    .querySelectorAll(`:scope > svg.${RESTORE_SVG_CLASS}`)
    .forEach((node) => node.remove());
}

/**
 * Render a saved {@link CharResult} into `target` as a static SVG.
 *
 * Pure renderer: does not create a {@link Char} instance, does not
 * mount, does not attach event handlers. Subsequent calls replace any
 * previously-restored SVG inside `target`.
 *
 * `result.perStroke[].points` are expected to be in hanzi-writer
 * internal coords (the contract established by `Char.checkStroke` /
 * mounted-quiz capture). Strokes shorter than two samples or with
 * `points` missing are skipped, so an in-progress
 * (`complete: false`) result renders only what has been observed.
 *
 * For `mode === "show"` results, the reference character is shown by
 * default (the result carries no polylines, so the cell would
 * otherwise be empty). Pass `showCharacter: false` explicitly to
 * suppress.
 */
export function charRestore(
  target: string | HTMLElement,
  result: CharResult,
  options: RestoreOptions,
): void {
  const el = resolveTarget(target, "char.restore()");
  const size = options.size;
  const padding = options.padding ?? DEFAULT_PADDING;
  validateSizeAndPadding(size, padding, "char.restore()");

  const isShowMode = result.mode === "show";
  // Show-mode cells carry no user strokes; auto-enable the reference
  // character so the cell isn't visibly empty. Caller can force
  // `false` to suppress.
  const showCharacter =
    options.showCharacter ?? (isShowMode || options.showOutline === true);

  const drawingWidth = options.drawingWidth ?? DEFAULT_DRAWING_WIDTH;
  const drawingColor = options.drawingColor ?? DEFAULT_DRAWING_COLOR;
  const okColor = options.okColor ?? drawingColor;
  const ngColor = options.ngColor ?? drawingColor;
  const referenceColor = options.strokeColor ?? DEFAULT_REFERENCE_COLOR;
  const charDataLoader: CharDataLoaderFn =
    options.charDataLoader ?? defaultCharDataLoader;

  const paint = (
    charData: { strokes: string[]; medians: number[][][] } | null,
  ): void => {
    const { svg, group } = buildCellChrome(size, padding, options.showGrid);
    if (showCharacter && charData) {
      appendCharacterPaths(group, charData.strokes, referenceColor);
    }
    appendUserPolylines(
      group,
      result.perStroke,
      drawingWidth,
      okColor,
      ngColor,
    );
    clearPriorRestoreSvg(el);
    el.appendChild(svg);
  };

  if (showCharacter && result.character) {
    charDataLoader(
      result.character,
      (data) => paint(data),
      (err) => {
        console.error(
          `char.restore(): failed to load character data for "${result.character}"`,
          err,
        );
        paint(null);
      },
    );
  } else {
    paint(null);
  }
}

/** Slot width along the cell axis, in cellSize units. */
function cellSpan(cell: BlockCellResult): number {
  if (cell.kind === "free") {
    return Math.max(cell.chars.length, 1);
  }
  return 1;
}

/**
 * Render a saved {@link BlockResult} into `target` as a static
 * arrangement of cell slots.
 *
 * Pure renderer: does not create a {@link import("./block/block.js").Block}
 * instance and never engages the matcher. Subsequent calls replace
 * any previously-restored block inside `target`.
 *
 * Layout mirrors `block.create`: cells stack top-to-bottom for
 * `writingMode: "vertical-rl"` (default) or left-to-right for
 * `"horizontal-tb"`. Each cell occupies `span * cellSize` along the
 * cell axis, where `span` derives from `chars.length`
 * (guided=1, free=N, blank=1). Free cells render each char in its
 * own sub-slot via {@link charRestore}; blank cells render only the
 * cell chrome.
 *
 * Annotations (ふりがな) are not rendered in v1: `BlockAnnotationResult`
 * does not carry the layout (`cellRange` / `placement` / `sizeRatio`)
 * needed to position them.
 */
export function blockRestore(
  target: string | HTMLElement,
  result: BlockResult,
  options: BlockRestoreOptions,
): void {
  const el = resolveTarget(target, "block.restore()");
  const cellSize = options.cellSize;
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(
      `block.restore(): cellSize must be a finite positive number (got ${cellSize}).`,
    );
  }
  const writingMode = options.writingMode ?? "vertical-rl";
  if (writingMode !== "vertical-rl" && writingMode !== "horizontal-tb") {
    throw new Error(
      `block.restore(): writingMode must be "vertical-rl" or "horizontal-tb" (got ${JSON.stringify(writingMode)}).`,
    );
  }
  const padding = options.padding ?? DEFAULT_PADDING;
  validateSizeAndPadding(cellSize, padding, "block.restore()");

  const cellBorderWidth = options.cellBorderWidth ?? DEFAULT_CELL_BORDER_WIDTH;
  const cellBorderColor = options.cellBorderColor ?? DEFAULT_CELL_BORDER_COLOR;

  const cells = result.cells;
  const spans = cells.map(cellSpan);
  const cellsExtent = spans.reduce((acc, s) => acc + s * cellSize, 0);

  const wrapper = document.createElement("div");
  wrapper.classList.add(BLOCK_RESTORE_CLASS);
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-block";
  wrapper.style.lineHeight = "0";
  if (writingMode === "horizontal-tb") {
    wrapper.style.width = `${cellsExtent}px`;
    wrapper.style.height = `${cellSize}px`;
  } else {
    wrapper.style.width = `${cellSize}px`;
    wrapper.style.height = `${cellsExtent}px`;
  }

  let runningOffset = 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const span = spans[i];
    const cellX = writingMode === "horizontal-tb" ? runningOffset : 0;
    const cellY = writingMode === "horizontal-tb" ? 0 : runningOffset;
    const cellWidth = writingMode === "horizontal-tb" ? span * cellSize : cellSize;
    const cellHeight = writingMode === "horizontal-tb" ? cellSize : span * cellSize;

    // The cell wrapper carries the border around the whole cell (so
    // free cells with N chars get one outer border instead of one per
    // char slot). Each char slot inside is borderless.
    const cellWrapper = document.createElement("div");
    cellWrapper.style.position = "absolute";
    cellWrapper.style.boxSizing = "border-box";
    cellWrapper.style.left = `${cellX}px`;
    cellWrapper.style.top = `${cellY}px`;
    cellWrapper.style.width = `${cellWidth}px`;
    cellWrapper.style.height = `${cellHeight}px`;
    if (cellBorderWidth > 0) {
      cellWrapper.style.border = `${cellBorderWidth}px solid ${cellBorderColor}`;
    }
    wrapper.appendChild(cellWrapper);

    const slotCount = cell.kind === "blank" ? 0 : cell.chars.length;
    if (slotCount === 0) {
      // Blank (or empty free) cell: paint the empty chrome via
      // charRestore with an empty result so showGrid / cell sizing
      // stays consistent with non-blank cells.
      const emptyResult: CharResult = {
        character: "",
        complete: false,
        matched: true,
        perStroke: [],
      };
      const slot = document.createElement("div");
      slot.style.position = "absolute";
      slot.style.left = "0";
      slot.style.top = "0";
      slot.style.width = `${cellWidth}px`;
      slot.style.height = `${cellHeight}px`;
      cellWrapper.appendChild(slot);
      charRestore(slot, emptyResult, {
        size: cellSize,
        padding,
        drawingWidth: options.drawingWidth,
        drawingColor: options.drawingColor,
        showGrid: options.showGrid,
        showCharacter: false,
        showOutline: false,
        strokeColor: options.strokeColor,
        okColor: options.okColor,
        ngColor: options.ngColor,
        charDataLoader: options.charDataLoader,
      });
    } else {
      for (let k = 0; k < slotCount; k++) {
        const slotX =
          writingMode === "horizontal-tb" ? k * cellSize : 0;
        const slotY =
          writingMode === "horizontal-tb" ? 0 : k * cellSize;
        const slot = document.createElement("div");
        slot.style.position = "absolute";
        slot.style.left = `${slotX}px`;
        slot.style.top = `${slotY}px`;
        slot.style.width = `${cellSize}px`;
        slot.style.height = `${cellSize}px`;
        cellWrapper.appendChild(slot);
        charRestore(slot, cell.chars[k], {
          size: cellSize,
          padding,
          drawingWidth: options.drawingWidth,
          drawingColor: options.drawingColor,
          showGrid: options.showGrid,
          showCharacter: options.showCharacter,
          showOutline: options.showOutline,
          strokeColor: options.strokeColor,
          okColor: options.okColor,
          ngColor: options.ngColor,
          charDataLoader: options.charDataLoader,
        });
      }
    }

    runningOffset += span * cellSize;
  }

  // Replace any prior block.restore wrapper in this target.
  el
    .querySelectorAll(`:scope > .${BLOCK_RESTORE_CLASS}`)
    .forEach((node) => node.remove());
  el.appendChild(wrapper);
}

/**
 * Synthesize a {@link BlockSpec} from a {@link BlockResult} so the
 * pure layout helper (`layoutPage`) can compute spans / segments
 * without needing the original spec. Only the fields layoutPage reads
 * (`kind`, `expected`, `span`) need to be present, so the synthesized
 * Cell is just enough to drive layout.
 */
function blockResultToSpec(blockResult: BlockResult): BlockSpec {
  const cells: Cell[] = blockResult.cells.map((c) => {
    if (c.kind === "guided") {
      return {
        kind: "guided",
        char: c.chars[0]?.character ?? "",
        mode: "write",
      };
    }
    if (c.kind === "blank") {
      return { kind: "blank" };
    }
    // free: layoutPage's cellSlotSpan reads `expected` length to
    // determine the span. Synthesize an `expected` string whose length
    // matches the chars[] entries.
    const len = Math.max(c.chars.length, 1);
    return {
      kind: "free",
      expected: "x".repeat(len),
      mode: "write",
    };
  });
  return { cells };
}

/**
 * Render a saved {@link PageResult} into `target` as a static page of
 * cell slots.
 *
 * Pure renderer: does not create a {@link import("./page/page.js").Page}
 * instance. Subsequent calls replace any previously-restored page
 * inside `target`.
 *
 * Layout vocabulary mirrors `page.create`: `columns` / `cellsPerColumn`
 * / `cellSize` / `writingMode` (default `"vertical-rl"`). Blocks flow
 * in declaration order, splitting at column boundaries via the same
 * `layoutPage` pass used by `page.create`. Annotations are skipped in
 * v1 because `BlockAnnotationResult` does not carry layout.
 */
export function pageRestore(
  target: string | HTMLElement,
  result: PageResult,
  options: PageRestoreOptions,
): void {
  const el = resolveTarget(target, "page.restore()");
  const { columns, cellsPerColumn, cellSize } = options;
  if (!Number.isInteger(columns) || columns <= 0) {
    throw new Error(
      `page.restore(): columns must be a positive integer (got ${columns}).`,
    );
  }
  if (!Number.isInteger(cellsPerColumn) || cellsPerColumn <= 0) {
    throw new Error(
      `page.restore(): cellsPerColumn must be a positive integer (got ${cellsPerColumn}).`,
    );
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(
      `page.restore(): cellSize must be a finite positive number (got ${cellSize}).`,
    );
  }
  const writingMode = options.writingMode ?? "vertical-rl";
  if (writingMode !== "vertical-rl" && writingMode !== "horizontal-tb") {
    throw new Error(
      `page.restore(): writingMode must be "vertical-rl" or "horizontal-tb" (got ${JSON.stringify(writingMode)}).`,
    );
  }

  // v1 restore skips the annotation strip entirely; lineThickness ==
  // cellSize lets us share the segmentOrigin math without threading
  // annotationStripThickness through.
  const lineThickness = cellSize;
  const pageWidth =
    writingMode === "vertical-rl" ? columns * lineThickness : cellsPerColumn * cellSize;
  const pageHeight =
    writingMode === "vertical-rl" ? cellsPerColumn * cellSize : columns * lineThickness;

  // Use the same pure layout helper the live Page uses so segments,
  // wrap-to-next-column behavior, and overflow errors match.
  const entries = result.blocks.map((br) => ({ spec: blockResultToSpec(br) }));
  const layout = layoutPage(entries, { columns, cellsPerColumn });

  const wrapper = document.createElement("div");
  wrapper.classList.add(PAGE_RESTORE_CLASS);
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-block";
  wrapper.style.lineHeight = "0";
  wrapper.style.width = `${pageWidth}px`;
  wrapper.style.height = `${pageHeight}px`;

  for (const seg of layout.segments) {
    const block = result.blocks[seg.blockIndex];
    if (!block) {
      continue;
    }
    const slicedCells = block.cells.slice(seg.cellFrom, seg.cellTo + 1);
    const sliced: BlockResult = {
      ...block,
      cells: slicedCells,
      annotations: [],
    };

    let originX: number;
    let originY: number;
    if (writingMode === "vertical-rl") {
      originX = pageWidth - (seg.column + 1) * lineThickness;
      originY = seg.cellInColumn * cellSize;
    } else {
      originX = seg.cellInColumn * cellSize;
      originY = seg.column * lineThickness;
    }

    const slot = document.createElement("div");
    slot.style.position = "absolute";
    slot.style.left = `${originX}px`;
    slot.style.top = `${originY}px`;
    wrapper.appendChild(slot);

    blockRestore(slot, sliced, {
      cellSize,
      writingMode,
      padding: options.padding,
      cellBorderWidth: options.cellBorderWidth,
      cellBorderColor: options.cellBorderColor,
      drawingWidth: options.drawingWidth,
      drawingColor: options.drawingColor,
      showGrid: options.showGrid,
      showCharacter: options.showCharacter,
      showOutline: options.showOutline,
      strokeColor: options.strokeColor,
      okColor: options.okColor,
      ngColor: options.ngColor,
      charDataLoader: options.charDataLoader,
    });
  }

  el
    .querySelectorAll(`:scope > .${PAGE_RESTORE_CLASS}`)
    .forEach((node) => node.remove());
  el.appendChild(wrapper);
}
