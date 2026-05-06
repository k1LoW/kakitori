import { describe, it, expect } from "vitest";
import { segmentByStrokeCounts } from "./segmentation.js";
import type { TimedPoint } from "../types.js";

function mkStroke(label: number): TimedPoint[] {
  // Each stroke gets a distinguishable point so we can verify ordering.
  return [{ x: label, y: label, t: label }];
}

describe("segmentByStrokeCounts", () => {
  it("splits strokes into per-character groups", () => {
    const strokes = [mkStroke(1), mkStroke(2), mkStroke(3), mkStroke(4)];
    const groups = segmentByStrokeCounts(strokes, [1, 3]);
    expect(groups.length).toBe(2);
    expect(groups[0].length).toBe(1);
    expect(groups[0][0][0]).toEqual({ x: 1, y: 1, t: 1 });
    expect(groups[1].length).toBe(3);
    expect(groups[1][0][0]).toEqual({ x: 2, y: 2, t: 2 });
    expect(groups[1][1][0]).toEqual({ x: 3, y: 3, t: 3 });
    expect(groups[1][2][0]).toEqual({ x: 4, y: 4, t: 4 });
  });

  it("handles arbitrary length sums", () => {
    const strokes = Array.from({ length: 18 }, (_, i) => mkStroke(i));
    const groups = segmentByStrokeCounts(strokes, [8, 10]);
    expect(groups[0].length).toBe(8);
    expect(groups[1].length).toBe(10);
  });

  it("returns independent stroke arrays (mutation safe)", () => {
    const original: TimedPoint[][] = [
      [{ x: 1, y: 1, t: 1 }],
      [{ x: 2, y: 2, t: 2 }],
    ];
    const groups = segmentByStrokeCounts(original, [1, 1]);
    groups[0][0].push({ x: 99, y: 99, t: 99 });
    expect(original[0].length).toBe(1);
  });

  it("throws when counts sum mismatches strokes length", () => {
    const strokes = [mkStroke(1), mkStroke(2)];
    expect(() => segmentByStrokeCounts(strokes, [1, 2])).toThrow(
      "stroke count mismatch",
    );
  });

  it("throws when any count is negative or non-integer", () => {
    const strokes = [mkStroke(1), mkStroke(2)];
    expect(() => segmentByStrokeCounts(strokes, [-1, 3])).toThrow(
      "non-negative integer",
    );
    expect(() => segmentByStrokeCounts(strokes, [0.5, 1.5])).toThrow(
      "non-negative integer",
    );
  });

  it("accepts zero counts (a 0-stroke character is an empty group)", () => {
    const strokes = [mkStroke(1)];
    const groups = segmentByStrokeCounts(strokes, [0, 1]);
    expect(groups[0]).toEqual([]);
    expect(groups[1].length).toBe(1);
  });
});
