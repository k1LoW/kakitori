import {
  DEFAULT_DRAWING_WIDTH,
  DEFAULT_PADDING,
  HANZI_PRESCALED_SIZE,
  HANZI_Y_BASELINE_OFFSET,
} from "./constants.js";
import { drawCrossGrid } from "./grid.js";
import { defaultCharDataLoader } from "./dataLoader.js";
import type {
  CharDataLoaderFn,
  CharResult,
  CharStrokeResult,
  RestoreOptions,
} from "./charOptions.js";
import type { TimedPoint } from "./types.js";
import type {
  BlockAnnotationResult,
  BlockCellResult,
  BlockResult,
  BlockRestoreOptions,
  BlockSpec,
  Cell,
} from "./block/types.js";
import type { WritingMode } from "./block/block.js";
import type { PageResult, PageRestoreOptions } from "./page/types.js";
import { layoutPage } from "./page/layout.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const RESTORE_SVG_CLASS = "kakitori-restore-svg";
const BLOCK_RESTORE_CLASS = "kakitori-block-restore";
const PAGE_RESTORE_CLASS = "kakitori-page-restore";

const DEFAULT_REFERENCE_COLOR = "#555";
const DEFAULT_OUTLINE_COLOR = "#ddd";
const DEFAULT_DRAWING_COLOR = "#222";
const DEFAULT_CELL_BORDER_WIDTH = 1;
// Match `block.create`'s default so restored chrome looks the same as
// the live page without the caller needing to thread a color through.
const DEFAULT_CELL_BORDER_COLOR = "#ddd";
// Block / page contexts paint a tighter cross-grid than `char.render` /
// `Char.mount` so the lines stay visible in smaller cells. Matches
// `block/block.ts`'s `DEFAULT_GRID_DASH_ARRAY`; restoration paths use
// this when the caller does not override the dashArray.
const BLOCK_GRID_DASH_ARRAY = "3,3";
// Annotation strip thickness fraction. Mirrors
// `block/block.ts`'s `DEFAULT_ANNOTATION_RATIO`.
const DEFAULT_ANNOTATION_RATIO = 0.4;

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
  // Match the create-side default: `block.create` / `page.create` /
  // `Char.mount` all paint the cross-grid by default, so a saved cell
  // restored without an explicit option should look the same.
  if (showGrid !== false) {
    drawCrossGrid(svg, size, showGrid === undefined || showGrid === true ? true : showGrid);
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
 * Per-target generation counter. `charRestore` claims the next
 * generation when invoked, captures it in the loader callback, and
 * checks `targetGeneration.get(el) === captured` before painting. A
 * fast follow-up call bumps the generation, so the older loader's
 * callback no-ops instead of overwriting the newer render with stale
 * SVG content.
 */
const targetGeneration = new WeakMap<HTMLElement, number>();

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
  const showCharacter = options.showCharacter ?? isShowMode;
  const showOutline = options.showOutline ?? false;

  const drawingWidth = options.drawingWidth ?? DEFAULT_DRAWING_WIDTH;
  const drawingColor = options.drawingColor ?? DEFAULT_DRAWING_COLOR;
  const okColor = options.okColor ?? drawingColor;
  const ngColor = options.ngColor ?? drawingColor;
  const referenceColor = options.strokeColor ?? DEFAULT_REFERENCE_COLOR;
  const outlineColor = options.outlineColor ?? DEFAULT_OUTLINE_COLOR;
  const charDataLoader: CharDataLoaderFn =
    options.charDataLoader ?? defaultCharDataLoader;

  const needsCharData =
    (showCharacter || showOutline) && !!result.character;

  // Claim a fresh generation for `el`. A subsequent `char.restore`
  // call on the same target bumps the counter, so any in-flight
  // loader callback from this call becomes stale and must no-op
  // instead of overwriting the newer render with stale SVG.
  const generation = (targetGeneration.get(el) ?? 0) + 1;
  targetGeneration.set(el, generation);

  const paint = (
    charData: { strokes: string[]; medians: number[][][] } | null,
  ): void => {
    if (targetGeneration.get(el) !== generation) {
      return;
    }
    const { svg, group } = buildCellChrome(size, padding, options.showGrid);
    // Outline first so the filled character (if any) paints on top of
    // it, matching hanzi-writer's layering when both are shown.
    if (showOutline && charData) {
      appendCharacterPaths(group, charData.strokes, outlineColor);
    }
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

  if (needsCharData) {
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

/**
 * Translate `BlockRestoreOptions.showGrid` into the
 * {@link RestoreOptions.showGrid} value that each per-cell
 * `charRestore` call should receive. Mirrors `block.create`'s grid
 * resolution (see `block/block.ts` `mountGuidedCell`): a bare
 * `true` / `undefined` becomes a `GridOptions` object pinned to the
 * cell border color / width plus the block-context dash array, so
 * restored cells look like live ones instead of falling through to
 * `drawCrossGrid`'s `char`-context defaults (`#ccc` / `"10,10"` /
 * width 2).
 */
function resolveBlockGrid(
  userShowGrid: BlockRestoreOptions["showGrid"],
  cellBorderColor: string,
  cellBorderWidth: number,
): RestoreOptions["showGrid"] {
  if (userShowGrid === false) {
    return false;
  }
  if (userShowGrid === undefined || userShowGrid === true) {
    return {
      color: cellBorderColor,
      width: cellBorderWidth,
      dashArray: BLOCK_GRID_DASH_ARRAY,
    };
  }
  return {
    ...userShowGrid,
    dashArray: userShowGrid.dashArray ?? BLOCK_GRID_DASH_ARRAY,
  };
}

/** Slot width along the cell axis, in cellSize units. */
function cellSpan(cell: BlockCellResult, cellIndex: number): number {
  // Honour any explicit `span` carried over from the spec; without it
  // free cells fall back to their content width and blank/guided cells
  // default to one slot. Validate the explicit value the same way
  // `layoutPage` does (positive integer): an out-of-range span would
  // otherwise silently break sizing / positioning of every following
  // cell.
  if (cell.span != null) {
    if (!Number.isInteger(cell.span) || cell.span <= 0) {
      throw new Error(
        `block.restore(): cells[${cellIndex}].span must be a positive integer (got ${cell.span}).`,
      );
    }
    return cell.span;
  }
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
 * When `result.annotations` is non-empty, an annotation strip is
 * reserved on the appropriate side (default `"right"` for
 * vertical-rl, `"top"` for horizontal-tb — same constraint
 * `block.create` enforces), sized off the largest `sizeRatio` across
 * annotations. Each annotation's characters are rendered into the
 * strip across the cellRange via `char.restore`. Annotations whose
 * `BlockAnnotationResult.cellRange` is missing are silently skipped
 * (older results predate the schema extension).
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
  // Translate the block-level showGrid into a per-cell GridOptions so
  // restored grids match `block.create`'s visuals (border-coloured,
  // border-width, "3,3" dash) instead of charRestore's `char`-context
  // defaults.
  const resolvedShowGrid = resolveBlockGrid(
    options.showGrid,
    cellBorderColor,
    cellBorderWidth,
  );

  const cells = result.cells;
  const spans = cells.map((c, i) => cellSpan(c, i));
  const cellsExtent = spans.reduce((acc, s) => acc + s * cellSize, 0);

  // Reserve the annotation strip on the perpendicular axis when the
  // result carries any renderable annotations. Mirrors `block.create`'s
  // sizing rule: strip thickness = max(sizeRatio * cellSize) across
  // annotations, defaulting to `DEFAULT_ANNOTATION_RATIO` when no
  // sizeRatio is set. Annotations missing `cellRange` cannot be
  // positioned and are dropped from both thickness and rendering, so
  // legacy results that pre-date the cellRange / placement / sizeRatio
  // fields lay out as if no annotation strip were present at all
  // (instead of reserving a dead strip the renderer can't fill).
  // Pair each renderable annotation with its index in the original
  // `result.annotations` array so error messages and per-annotation
  // bookkeeping point at the field the caller actually wrote, not the
  // post-filter offset (a legacy annotation missing `cellRange` ahead
  // of a malformed one would otherwise shift every subsequent index
  // by one).
  const renderableAnnotations: Array<{
    annotation: BlockAnnotationResult;
    originalIndex: number;
  }> = (result.annotations ?? [])
    .map((annotation, originalIndex) => ({ annotation, originalIndex }))
    .filter(({ annotation }) => annotation.cellRange !== undefined);
  renderableAnnotations.forEach(({ annotation, originalIndex }) => {
    // Mirror `block.create`'s validation: a zero or non-finite sizeRatio
    // collapses the strip to a degenerate width/height and breaks the
    // layout math. Restore can be fed a result loaded from JSON (possibly
    // hand-edited or produced by a different version), so reject the
    // same way `block.create` does up-front instead of letting it
    // propagate into `Math.max` / placement calculations.
    if (
      annotation.sizeRatio !== undefined &&
      (!Number.isFinite(annotation.sizeRatio) || annotation.sizeRatio <= 0)
    ) {
      throw new Error(
        `block.restore(): annotations[${originalIndex}].sizeRatio must be a finite positive number (got ${annotation.sizeRatio}).`,
      );
    }
  });
  const requiredAnnotationThickness =
    renderableAnnotations.length === 0
      ? 0
      : Math.max(
          ...renderableAnnotations.map(
            ({ annotation }) =>
              (annotation.sizeRatio ?? DEFAULT_ANNOTATION_RATIO) * cellSize,
          ),
        );
  // `showAnnotationStrip: false` turns the strip off entirely
  // (restore-only convenience; `block.create` has no equivalent
  // toggle, only the page-level `PageCreateOptions.showAnnotationStrip`
  // does). `annotationStripThickness` lets the caller (in practice,
  // `page.restore`) override the derived thickness so every block on
  // the same page reserves the same strip width even if some
  // segments don't carry any annotations themselves.
  let annotationThickness: number;
  if (options.showAnnotationStrip === false) {
    annotationThickness = 0;
  } else if (options.annotationStripThickness !== undefined) {
    if (
      !Number.isFinite(options.annotationStripThickness) ||
      options.annotationStripThickness < 0
    ) {
      throw new Error(
        `block.restore(): annotationStripThickness must be a finite non-negative number (got ${options.annotationStripThickness}).`,
      );
    }
    if (options.annotationStripThickness < requiredAnnotationThickness) {
      throw new Error(
        `block.restore(): annotationStripThickness=${options.annotationStripThickness} is smaller than the largest annotation thickness in this result (${requiredAnnotationThickness}).`,
      );
    }
    annotationThickness = options.annotationStripThickness;
  } else {
    annotationThickness = requiredAnnotationThickness;
  }
  // Padding is also forwarded into per-annotation `charRestore` calls
  // where `size === annotationThickness` (typically smaller than
  // `cellSize`), so a padding that's valid for cellSize can still
  // exceed annotationThickness/2 and fail inside char.restore mid-
  // render. Validate it up front against the strip size too whenever
  // a strip is reserved.
  if (
    annotationThickness > 0 &&
    padding > 0 &&
    padding >= annotationThickness / 2
  ) {
    throw new Error(
      `block.restore(): padding (${padding}) must be less than annotationThickness/2 (${annotationThickness / 2}).`,
    );
  }
  // Default placement matches block.create: "right" for vertical-rl,
  // "top" for horizontal-tb. Other placements aren't supported (the
  // live block rejects them too), so the only cell offset needed is
  // a downward shift in horizontal-tb to make room for the top strip.
  const cellOffsetY =
    writingMode === "horizontal-tb" ? annotationThickness : 0;

  const wrapper = document.createElement("div");
  wrapper.classList.add(BLOCK_RESTORE_CLASS);
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-block";
  wrapper.style.lineHeight = "0";
  // Match `block.create`'s wrapper: anchor at the line-box top so the
  // host page's font descender doesn't add trailing whitespace under
  // the last cell row.
  wrapper.style.verticalAlign = "top";
  if (writingMode === "horizontal-tb") {
    wrapper.style.width = `${cellsExtent}px`;
    wrapper.style.height = `${cellSize + annotationThickness}px`;
  } else {
    wrapper.style.width = `${cellSize + annotationThickness}px`;
    wrapper.style.height = `${cellsExtent}px`;
  }

  let runningOffset = 0;
  // Cell rects are recorded here so the annotation-strip code below can
  // line up each annotation across the matching cellRange.
  const cellRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const span = spans[i];
    const cellX = writingMode === "horizontal-tb" ? runningOffset : 0;
    const cellY = (writingMode === "horizontal-tb" ? 0 : runningOffset) + cellOffsetY;
    const cellWidth = writingMode === "horizontal-tb" ? span * cellSize : cellSize;
    const cellHeight = writingMode === "horizontal-tb" ? cellSize : span * cellSize;
    cellRects.push({ x: cellX, y: cellY, w: cellWidth, h: cellHeight });

    // Outer border policy mirrors `block.create`: guided / free cells
    // get one wrapper border around the whole span, while blank cells
    // delegate to per-slot borders below so a span-N blank shows the
    // same N-bordered placeholder layout that `block.create`'s
    // `mountBlankCell` paints. Without this distinction a blank cell
    // with span > 1 would either be missing per-slot borders (single
    // outer border only) or carry both (double-thickness).
    const useOuterBorder = cell.kind !== "blank";
    const cellWrapper = document.createElement("div");
    cellWrapper.style.position = "absolute";
    cellWrapper.style.boxSizing = "border-box";
    cellWrapper.style.left = `${cellX}px`;
    cellWrapper.style.top = `${cellY}px`;
    cellWrapper.style.width = `${cellWidth}px`;
    cellWrapper.style.height = `${cellHeight}px`;
    if (useOuterBorder && cellBorderWidth > 0) {
      cellWrapper.style.border = `${cellBorderWidth}px solid ${cellBorderColor}`;
      // Slots inside are absolutely positioned at `k * cellSize` and
      // sized `cellSize`, but border-box shrinks the wrapper's content
      // box by `2 * cellBorderWidth`, so the last slot would otherwise
      // overhang the bordered box by that much. Clipping keeps the
      // restored content inside the same rectangle the border outlines.
      cellWrapper.style.overflow = "hidden";
    }
    wrapper.appendChild(cellWrapper);

    // Render one slot per span unit. Slots beyond `cell.chars.length`
    // (blank cells, or free / guided cells whose recorded chars don't
    // fill the reserved width) fall through to an empty chrome render
    // so the spanned area visually matches `block.create`'s output
    // instead of leaving the trailing slots blank.
    const emptyChar: CharResult = {
      character: "",
      complete: false,
      matched: true,
      perStroke: [],
    };
    for (let k = 0; k < span; k++) {
      const slotX = writingMode === "horizontal-tb" ? k * cellSize : 0;
      const slotY = writingMode === "horizontal-tb" ? 0 : k * cellSize;
      const slot = document.createElement("div");
      slot.style.position = "absolute";
      slot.style.boxSizing = "border-box";
      slot.style.left = `${slotX}px`;
      slot.style.top = `${slotY}px`;
      slot.style.width = `${cellSize}px`;
      slot.style.height = `${cellSize}px`;
      if (!useOuterBorder && cellBorderWidth > 0) {
        slot.style.border = `${cellBorderWidth}px solid ${cellBorderColor}`;
        // Same border-box overhang concern as the outer wrapper above:
        // the inner SVG keeps its full `cellSize` width, so clip it to
        // the slot's bordered box.
        slot.style.overflow = "hidden";
      }
      cellWrapper.appendChild(slot);

      const charForSlot = k < cell.chars.length ? cell.chars[k] : emptyChar;
      const slotIsEmpty = charForSlot === emptyChar;
      // Free cells live in one continuous writing area in
      // `block.create` and never draw a cross-grid. Restore renders
      // each captured char into its own slot (one per `cell.chars`
      // entry) for layout, but the grid should still match the live
      // visual: default it off for free cells unless the caller
      // explicitly opted in via `options.showGrid`.
      const slotShowGrid =
        cell.kind === "free" && options.showGrid === undefined
          ? false
          : resolvedShowGrid;
      charRestore(slot, charForSlot, {
        size: cellSize,
        padding,
        drawingWidth: options.drawingWidth,
        drawingColor: options.drawingColor,
        showGrid: slotShowGrid,
        // Empty placeholder slots never have a real character to show
        // (synthetic empty CharResult), so suppress showCharacter /
        // showOutline regardless of the caller's preference to avoid
        // loading char data for an empty character string.
        showCharacter: slotIsEmpty ? false : options.showCharacter,
        showOutline: slotIsEmpty ? false : options.showOutline,
        strokeColor: options.strokeColor,
        outlineColor: options.outlineColor,
        okColor: options.okColor,
        ngColor: options.ngColor,
        charDataLoader: options.charDataLoader,
      });
    }

    runningOffset += span * cellSize;
  }

  // Reserve an empty annotation strip frame next to every cell-slot
  // (one per cellSize chunk in the cell's span) so block-stacking on a
  // page stays visually uniform whether or not an annotation lands on
  // that slot. Mirrors `block.create`'s `drawEmptyAnnotationStripFrame`
  // so a restored block looks identical to the live render even for
  // cells outside any annotation's cellRange. The per-char overlay
  // inside `renderAnnotation` is borderless and paints content on top
  // of these frames.
  if (annotationThickness > 0 && cellBorderWidth > 0) {
    for (let i = 0; i < cellRects.length; i++) {
      const rect = cellRects[i];
      const span = spans[i];
      for (let k = 0; k < span; k++) {
        const frame = document.createElement("div");
        frame.style.position = "absolute";
        frame.style.boxSizing = "border-box";
        frame.style.pointerEvents = "none";
        if (writingMode === "vertical-rl") {
          frame.style.left = `${rect.x + cellSize}px`;
          frame.style.top = `${rect.y + k * cellSize}px`;
          frame.style.width = `${annotationThickness}px`;
          frame.style.height = `${cellSize}px`;
        } else {
          frame.style.left = `${rect.x + k * cellSize}px`;
          frame.style.top = `${rect.y - annotationThickness}px`;
          frame.style.width = `${cellSize}px`;
          frame.style.height = `${annotationThickness}px`;
        }
        frame.style.border = `${cellBorderWidth}px solid ${cellBorderColor}`;
        wrapper.appendChild(frame);
      }
    }
  }

  // Annotation strips ride on top of the cell layout. Each annotation
  // spans `cellRange[from..to]` on the cell axis and sits perpendicular
  // (right for vertical-rl, top for horizontal-tb).
  if (annotationThickness > 0) {
    for (const { annotation, originalIndex } of renderableAnnotations) {
      renderAnnotation(
        wrapper,
        annotation,
        originalIndex,
        cellRects,
        spans,
        cellSize,
        annotationThickness,
        writingMode,
        options,
        padding,
      );
    }
  }

  // Replace any prior block.restore wrapper in this target.
  el
    .querySelectorAll(`:scope > .${BLOCK_RESTORE_CLASS}`)
    .forEach((node) => node.remove());
  el.appendChild(wrapper);
}

/**
 * Render one annotation strip into the block wrapper. Splits the strip
 * into one sub-strip per cell in the `cellRange` (matching
 * `block.create`'s `mountAnnotation` layout), distributes the
 * annotation's chars evenly across those sub-strips, and renders each
 * char via {@link charRestore} at the strip's perpendicular size.
 *
 * Annotations without a `cellRange` (older results predating the
 * schema extension) are skipped silently. Placements other than
 * `"right"` for vertical-rl / `"top"` for horizontal-tb throw,
 * matching `block.create`'s validation.
 */
function renderAnnotation(
  wrapper: HTMLElement,
  annotation: BlockAnnotationResult,
  annotationIndex: number,
  cellRects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
  spans: ReadonlyArray<number>,
  cellSize: number,
  annotationThickness: number,
  writingMode: WritingMode,
  options: BlockRestoreOptions,
  padding: number,
): void {
  const range = annotation.cellRange;
  if (!range) {
    return;
  }
  const [from, to] = range;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to >= cellRects.length ||
    from > to
  ) {
    throw new Error(
      `block.restore(): annotations[${annotationIndex}].cellRange [${from}, ${to}] is out of range for ${cellRects.length} cell(s).`,
    );
  }
  const expectedPlacement = writingMode === "vertical-rl" ? "right" : "top";
  if (annotation.placement !== undefined && annotation.placement !== expectedPlacement) {
    throw new Error(
      `block.restore(): annotations[${annotationIndex}].placement must be ${JSON.stringify(expectedPlacement)} for writingMode ${JSON.stringify(writingMode)} (got ${JSON.stringify(annotation.placement)}).`,
    );
  }
  // Each cell in the cellRange must be span 1. The sub-strip layout
  // below builds exactly one `cellSize`-thick rectangle per covered
  // cell, so a span>1 cell would leave its trailing slots uncovered
  // (and the sub-strip dividers misaligned with the cells/empty
  // strip frames above). Block.create rejects this configuration at
  // build time for the same reason; mirror that validation here
  // because restore can be fed JSON-loaded results that bypass
  // block.create's checks.
  for (let k = from; k <= to; k++) {
    if (spans[k] > 1) {
      throw new Error(
        `block.restore(): annotations[${annotationIndex}].cellRange covers cells[${k}] with span=${spans[k]}; annotated cells must have span 1.`,
      );
    }
  }

  const cellCount = to - from + 1;
  // Sub-strip layout matches block.ts mountAnnotation: one sub-strip
  // per covered cell, sized cellSize along the cell axis and
  // annotationThickness on the perpendicular axis.
  const subStripRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let k = 0; k < cellCount; k++) {
    if (writingMode === "vertical-rl") {
      subStripRects.push({
        x: cellSize,
        y: cellRects[from].y + k * cellSize,
        w: annotationThickness,
        h: cellSize,
      });
    } else {
      subStripRects.push({
        x: cellRects[from].x + k * cellSize,
        y: 0,
        w: cellSize,
        h: annotationThickness,
      });
    }
  }

  // Distribute the annotation's chars across the sub-strips using the
  // same rounding rule as `renderShowAcrossSubStrips` so a 4-char
  // annotation spread over 2 sub-strips lands 2 per strip.
  const chars = annotation.chars;
  // FreeCell normalizes each character's captured strokes
  // (`normalizeCharacterSegment` in recognition/normalize.ts) so the
  // stored `CharStrokeResult.points` are aspect-preserved and centred
  // in the standard internal-coord region. Rendering them in a square
  // slot (`charSize × charSize`) is the correct match; any non-square
  // slot here would re-introduce an aspect distortion the normalize
  // pass deliberately removed.
  const charSize = annotationThickness;
  let prevEnd = 0;
  for (let k = 0; k < cellCount; k++) {
    const isLast = k === cellCount - 1;
    const targetEnd = isLast
      ? chars.length
      : Math.round(((k + 1) * chars.length) / cellCount);
    const end = Math.min(chars.length, Math.max(prevEnd, targetEnd));
    const charsInStrip = chars.slice(prevEnd, end);
    prevEnd = end;
    if (charsInStrip.length === 0) {
      continue;
    }
    const stripRect = subStripRects[k];
    const isVertical = writingMode === "vertical-rl";
    const stripAxisLength = isVertical ? stripRect.h : stripRect.w;
    const slotLength = stripAxisLength / charsInStrip.length;

    // Per-char overlay frames sub-divide the sub-strip into one slot
    // per character. They are borderless: the empty annotation strip
    // frames painted next to every cell-slot upstream provide the outer
    // border (matching `block.create`, which intentionally leaves
    // `mountAnnotation`'s overlay elements borderless so the cell-slot
    // border isn't doubled). The char SVG inside is square (charSize ×
    // charSize) and centred within the slot: normalize.ts pins the
    // user's bbox centre to the median bbox centre with longer-side
    // scaling, so the captured points always fit the standard hanzi
    // region and no overflow padding is needed in the slot.
    for (let i = 0; i < charsInStrip.length; i++) {
      const slotFrame = document.createElement("div");
      slotFrame.style.position = "absolute";
      slotFrame.style.pointerEvents = "none";
      // Clip char content to the slot. When many annotation chars are
      // packed into a short cellRange chunk (slotLength <
      // annotationThickness), the centred square char SVG
      // (`charSize === annotationThickness`) would otherwise spill
      // into neighbouring slots on the long axis. `overflow: hidden`
      // keeps each char strictly within the intended slot rectangle
      // without affecting the borderless overlay's role (the cell-
      // slot base frame upstream still owns the visible chrome).
      slotFrame.style.overflow = "hidden";
      const frameWidth = isVertical ? annotationThickness : slotLength;
      const frameHeight = isVertical ? slotLength : annotationThickness;
      if (isVertical) {
        slotFrame.style.left = `${stripRect.x}px`;
        slotFrame.style.top = `${stripRect.y + i * slotLength}px`;
      } else {
        slotFrame.style.left = `${stripRect.x + i * slotLength}px`;
        slotFrame.style.top = `${stripRect.y}px`;
      }
      slotFrame.style.width = `${frameWidth}px`;
      slotFrame.style.height = `${frameHeight}px`;

      const charBox = document.createElement("div");
      charBox.style.position = "absolute";
      charBox.style.width = `${charSize}px`;
      charBox.style.height = `${charSize}px`;
      charBox.style.left = `${(frameWidth - charSize) / 2}px`;
      charBox.style.top = `${(frameHeight - charSize) / 2}px`;
      slotFrame.appendChild(charBox);
      wrapper.appendChild(slotFrame);

      charRestore(charBox, charsInStrip[i], {
        size: charSize,
        padding,
        drawingWidth: options.drawingWidth,
        drawingColor: options.drawingColor,
        // Suppress the per-char cross-grid; the cell-slot empty frame
        // upstream already provides the outer chrome.
        showGrid: false,
        showCharacter: options.showCharacter,
        showOutline: options.showOutline,
        strokeColor: options.strokeColor,
        outlineColor: options.outlineColor,
        okColor: options.okColor,
        ngColor: options.ngColor,
        charDataLoader: options.charDataLoader,
      });
    }
  }
}

/**
 * Synthesize a {@link BlockSpec} from a {@link BlockResult} so the
 * pure layout helper (`layoutPage`) can compute spans / segments
 * without needing the original spec. Only the fields layoutPage reads
 * (`kind`, `expected`, `span`) need to be present, so the synthesized
 * Cell is just enough to drive layout.
 */
/**
 * Slice the block-level annotations so that each output annotation
 * targets a single cell inside the given segment and carries the
 * exact chars that cell owned in the original `renderAnnotation`
 * distribution (rounded `k * chars / cellCount` boundaries).
 *
 * Per-cell slicing is required because `renderAnnotation` would
 * otherwise re-distribute the sliced chars over the segment's local
 * cell count. The two distributions only match for uniform splits.
 * Example: 3 cells, 5 chars => per-cell counts (2, 1, 2). Slicing
 * to cells 1..2 leaves 3 chars over 2 cells => new distribution
 * (2, 1) instead of (1, 2). Splitting into 1-cell annotations
 * sidesteps the round-trip mismatch entirely (a 1-cell annotation
 * with M chars trivially places M chars in its one slot).
 *
 * Annotations missing `cellRange` are dropped (matches
 * `block.restore`'s renderable-annotation filter). Per-cell slices
 * preserve `placement` / `sizeRatio` so the page-level strip
 * thickness stays consistent across segments.
 */
function sliceAnnotationsForSegment(
  annotations: ReadonlyArray<BlockAnnotationResult>,
  segCellFrom: number,
  segCellTo: number,
): BlockAnnotationResult[] {
  const out: BlockAnnotationResult[] = [];
  for (const anno of annotations) {
    if (!anno.cellRange) {
      continue;
    }
    const [annoFrom, annoTo] = anno.cellRange;
    const overlapStart = Math.max(annoFrom, segCellFrom);
    const overlapEnd = Math.min(annoTo, segCellTo);
    if (overlapStart > overlapEnd) {
      continue;
    }
    const annoChars = anno.chars;
    const annoCellCount = annoTo - annoFrom + 1;
    // Mirror `renderAnnotation`'s boundary math so the per-cell
    // char arrays here line up with how the live block laid them
    // out. The last boundary is clamped to `chars.length` to match
    // the `isLast` branch in `renderAnnotation`.
    const boundary = (k: number): number =>
      k >= annoCellCount
        ? annoChars.length
        : Math.round((k * annoChars.length) / annoCellCount);
    for (let cellIdx = overlapStart; cellIdx <= overlapEnd; cellIdx++) {
      const localInAnno = cellIdx - annoFrom;
      const charStart = boundary(localInAnno);
      const charEnd = boundary(localInAnno + 1);
      const cellChars = annoChars.slice(charStart, charEnd);
      const localCellInSeg = cellIdx - segCellFrom;
      const sliced: BlockAnnotationResult = {
        cellRange: [localCellInSeg, localCellInSeg],
        chars: cellChars,
      };
      if (anno.placement !== undefined) {
        sliced.placement = anno.placement;
      }
      if (anno.sizeRatio !== undefined) {
        sliced.sizeRatio = anno.sizeRatio;
      }
      out.push(sliced);
    }
  }
  return out;
}

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
      const blank: Cell = { kind: "blank" };
      if (c.span != null) {
        blank.span = c.span;
      }
      return blank;
    }
    // free: layoutPage's cellSlotSpan reads `expected` length to
    // determine the span. Synthesize an `expected` string whose length
    // matches the chars[] entries.
    const len = Math.max(c.chars.length, 1);
    const free: Cell = {
      kind: "free",
      expected: "x".repeat(len),
      mode: "write",
    };
    // Preserve the explicit span the spec carried (free cells with
    // `span > expected.length` reserve extra width). Without this,
    // layoutPage would compute segments at the narrower content
    // width and `page.restore` could place subsequent blocks where
    // they would have overlapped the wider cell in the live `page`.
    if (c.span != null) {
      free.span = c.span;
    }
    return free;
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
 * `layoutPage` pass used by `page.create`. Annotations carrying
 * layout fields are rendered alongside the cells they target, and
 * when a `cellRange` straddles a column wrap the annotation is
 * sliced per-cell across the segments so each cell keeps the chars
 * it originally carried in the live block.
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

  // Validate each renderable annotation's `sizeRatio` and
  // `cellRange` up front. `sizeRatio` mirrors `block.restore`'s
  // entrance check (otherwise a non-finite or non-positive value
  // silently produces NaN / negative `pageRequiredStrip`,
  // `annotationStripThickness`, `lineThickness`, and ends up in
  // the wrapper's inline `width` / `height` style). `cellRange`
  // must be checked here too because `sliceAnnotationsForSegment`
  // below rebases every overlapping annotation to a 1-cell
  // segment-local range; once that rebasing has happened,
  // `block.restore`'s own cellRange check (in `renderAnnotation`)
  // can never see an originally out-of-range or non-integer value
  // and would silently mis-render instead of throwing.
  result.blocks.forEach((b, blockIndex) => {
    (b.annotations ?? []).forEach((a, annotationIndex) => {
      if (a.cellRange === undefined) {
        return;
      }
      if (
        a.sizeRatio !== undefined &&
        (!Number.isFinite(a.sizeRatio) || a.sizeRatio <= 0)
      ) {
        throw new Error(
          `page.restore(): blocks[${blockIndex}].annotations[${annotationIndex}].sizeRatio must be a finite positive number (got ${a.sizeRatio}).`,
        );
      }
      const [from, to] = a.cellRange;
      const blockCellCount = b.cells.length;
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to >= blockCellCount ||
        from > to
      ) {
        throw new Error(
          `page.restore(): blocks[${blockIndex}].annotations[${annotationIndex}].cellRange [${from}, ${to}] is out of range for ${blockCellCount} cell(s).`,
        );
      }
    });
  });
  // Pick the page-wide annotation strip thickness up front so every
  // segment reserves the same width even when some segments carry
  // no annotation overlap. Mirrors `page.create`'s rule: the strip
  // sizes to the largest block annotation, floored at
  // `DEFAULT_ANNOTATION_RATIO * cellSize` so the strip stays
  // visually consistent across columns and a `PageResult` produced
  // by `page.create` round-trips through `page.restore` at the same
  // geometry whether or not its blocks happen to carry annotations.
  const blockRequiredStrips = result.blocks.map((b) => {
    const annotations = (b.annotations ?? []).filter(
      (a) => a.cellRange !== undefined,
    );
    return annotations.length === 0
      ? 0
      : Math.max(
          ...annotations.map(
            (a) => (a.sizeRatio ?? DEFAULT_ANNOTATION_RATIO) * cellSize,
          ),
        );
  });
  const pageRequiredStrip = Math.max(0, ...blockRequiredStrips);
  const showAnnotationStrip = options.showAnnotationStrip ?? true;
  let annotationStripThickness: number;
  if (showAnnotationStrip === false) {
    annotationStripThickness = 0;
  } else if (options.annotationStripThickness !== undefined) {
    if (
      !Number.isFinite(options.annotationStripThickness) ||
      options.annotationStripThickness < 0
    ) {
      throw new Error(
        `page.restore(): annotationStripThickness must be a finite non-negative number (got ${options.annotationStripThickness}).`,
      );
    }
    annotationStripThickness = options.annotationStripThickness;
  } else {
    annotationStripThickness = Math.max(
      pageRequiredStrip,
      DEFAULT_ANNOTATION_RATIO * cellSize,
    );
  }
  if (
    showAnnotationStrip !== false &&
    annotationStripThickness < pageRequiredStrip
  ) {
    throw new Error(
      `page.restore(): annotationStripThickness=${annotationStripThickness} is smaller than the largest block annotation thickness (${pageRequiredStrip}).`,
    );
  }
  const lineThickness = cellSize + annotationStripThickness;
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
  // Match `page.create` / `block.create` / `block.restore`: anchor at
  // the line-box top so the host page's font descender doesn't add
  // trailing whitespace below the last cell row.
  wrapper.style.verticalAlign = "top";
  wrapper.style.width = `${pageWidth}px`;
  wrapper.style.height = `${pageHeight}px`;

  for (const seg of layout.segments) {
    const block = result.blocks[seg.blockIndex];
    if (!block) {
      continue;
    }
    const slicedCells = block.cells.slice(seg.cellFrom, seg.cellTo + 1);
    // Slice annotations per cell so each segment carries the chars
    // its cells originally owned, even when the block's cellRange
    // straddles a column wrap. Re-running the original distribution
    // (`renderAnnotation`'s rounded boundaries) on the sliced chars
    // would re-shuffle the per-cell layout: see the comment block
    // in `sliceAnnotationsForSegment` for the math. When the
    // page-wide strip is disabled (`showAnnotationStrip: false`),
    // drop annotations entirely instead of letting them propagate
    // into blockRestore's `annotationStripThickness=0` validation
    // path (which would throw on a non-zero required thickness).
    const slicedAnnotations =
      showAnnotationStrip === false
        ? []
        : sliceAnnotationsForSegment(
            block.annotations ?? [],
            seg.cellFrom,
            seg.cellTo,
          );
    const sliced: BlockResult = {
      ...block,
      cells: slicedCells,
      annotations: slicedAnnotations,
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
      // Force the strip thickness to the page-wide value so every
      // segment reserves the same width even if its sliced
      // annotations are empty or smaller than the page max. Without
      // this, a segment with no overlap would compute its own
      // thickness as 0 and the cell would shift toward the strip
      // edge of the column.
      annotationStripThickness,
      drawingWidth: options.drawingWidth,
      drawingColor: options.drawingColor,
      showGrid: options.showGrid,
      showCharacter: options.showCharacter,
      showOutline: options.showOutline,
      strokeColor: options.strokeColor,
      outlineColor: options.outlineColor,
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
