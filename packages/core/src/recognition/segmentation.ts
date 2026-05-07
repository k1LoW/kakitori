import type { TimedPoint } from "../types.js";

/**
 * Split a flat sequence of strokes into per-character groups by stroke
 * count. Used by free cells: the user draws every character of the candidate
 * (e.g. "がっこう") into a single area; we know the per-character data
 * stroke counts (4 + 1 + 2 + 3 for that example) and can therefore split
 * the buffer into one stroke group per character.
 *
 * Throws when `counts.reduce((a, b) => a + b, 0)` does not equal
 * `strokes.length`. Callers (freeCell) are expected to call this only when
 * the running stroke total exactly matches a candidate's expected total.
 */
export function segmentByStrokeCounts(
  strokes: ReadonlyArray<ReadonlyArray<TimedPoint>>,
  counts: ReadonlyArray<number>,
): TimedPoint[][][] {
  // Validate per-count integrity first; otherwise a NaN entry would make
  // the sum NaN and surface as a misleading "stroke count mismatch".
  for (const c of counts) {
    if (!Number.isInteger(c) || c < 0) {
      throw new Error(
        `segmentByStrokeCounts(): each count must be a non-negative integer, got ${c}`,
      );
    }
  }
  const expected = counts.reduce((a, b) => a + b, 0);
  if (expected !== strokes.length) {
    throw new Error(
      `segmentByStrokeCounts(): stroke count mismatch — strokes=${strokes.length}, sum(counts)=${expected}`,
    );
  }
  const groups: TimedPoint[][][] = [];
  let cursor = 0;
  for (const c of counts) {
    const group: TimedPoint[][] = [];
    for (let i = 0; i < c; i++) {
      group.push(strokes[cursor + i].map((p) => ({ x: p.x, y: p.y, t: p.t })));
    }
    groups.push(group);
    cursor += c;
  }
  return groups;
}
