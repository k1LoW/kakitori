import type { GridOptions } from "./charOptions.js";

const DEFAULT_GRID_COLOR = "#ccc";
const DEFAULT_GRID_DASH = "10,10";
const DEFAULT_GRID_WIDTH = 2;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Append the cross-grid (one vertical + one horizontal mid-line) to
 * `svg`. Shared between `char.render` / `Char.mount` (live cell
 * chrome) and `char.restore` / `block.restore` / `page.restore`
 * (static result rendering) so both paths produce the same grid
 * without either module pulling the other in. Living in its own file
 * also breaks the `char` ↔ `restore` circular dependency that would
 * otherwise leave `char.restore` undefined under CommonJS require
 * cycles.
 */
export function drawCrossGrid(
  svg: SVGSVGElement,
  size: number,
  gridOpts: GridOptions | true,
): void {
  const opts = gridOpts === true ? {} : gridOpts;
  const color = opts.color ?? DEFAULT_GRID_COLOR;
  const dashArray = opts.dashArray ?? DEFAULT_GRID_DASH;
  const width = opts.width ?? DEFAULT_GRID_WIDTH;
  const mid = size / 2;

  const vLine = document.createElementNS(SVG_NS, "line");
  vLine.setAttribute("x1", String(mid));
  vLine.setAttribute("y1", "0");
  vLine.setAttribute("x2", String(mid));
  vLine.setAttribute("y2", String(size));
  vLine.setAttribute("stroke", color);
  vLine.setAttribute("stroke-width", String(width));
  vLine.setAttribute("stroke-dasharray", dashArray);
  vLine.setAttribute("pointer-events", "none");

  const hLine = document.createElementNS(SVG_NS, "line");
  hLine.setAttribute("x1", "0");
  hLine.setAttribute("y1", String(mid));
  hLine.setAttribute("x2", String(size));
  hLine.setAttribute("y2", String(mid));
  hLine.setAttribute("stroke", color);
  hLine.setAttribute("stroke-width", String(width));
  hLine.setAttribute("stroke-dasharray", dashArray);
  hLine.setAttribute("pointer-events", "none");

  svg.appendChild(vLine);
  svg.appendChild(hLine);
}
