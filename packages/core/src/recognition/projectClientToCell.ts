/**
 * Project a `clientX` / `clientY` pair into the local coordinate system of
 * a square cell element. The cell is assumed to be square and to fill its
 * bounding rect (no internal padding) — that's the simplest case relevant
 * for free cells; the more complex padded mapping lives in `char.ts`.
 *
 * Returns Y-down cell-local pixels (0 at the top edge, `cellSize` at the
 * bottom). The output coord system is **independent** of hanzi-writer's
 * internal Y-up coords: callers (freeCell) draw directly in this space and
 * only flip / normalize at match time via {@link normalizeCharacterSegment}.
 */
export function projectClientToCell(
  rect: { left: number; top: number; width: number },
  cellSize: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const displayedSize = rect.width || cellSize;
  const scale = cellSize / displayedSize;
  return {
    x: (clientX - rect.left) * scale,
    y: (clientY - rect.top) * scale,
  };
}
