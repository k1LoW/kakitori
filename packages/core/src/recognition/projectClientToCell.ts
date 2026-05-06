/**
 * Project a `clientX` / `clientY` pair into the local viewBox coordinate
 * system of a free-cell `<svg>`. Handles non-square cells (e.g. tall furigana
 * strips) by scaling each axis independently.
 *
 * Returns Y-down cell-local coords (0 at the top edge, `viewBoxHeight` at
 * the bottom). The output is independent of hanzi-writer's Y-up internal
 * coords: callers (freeCell) draw directly in this space and only flip /
 * normalize at match time via {@link normalizeCharacterSegment}.
 */
export function projectClientToCell(
  rect: { left: number; top: number; width: number; height: number },
  viewBoxWidth: number,
  viewBoxHeight: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const displayedWidth = rect.width || viewBoxWidth;
  const displayedHeight = rect.height || viewBoxHeight;
  return {
    x: ((clientX - rect.left) / displayedWidth) * viewBoxWidth,
    y: ((clientY - rect.top) / displayedHeight) * viewBoxHeight,
  };
}
