import { describe, it, expect } from "vitest";
import { normalizeCharacterSegment } from "./normalize.js";
import type { TimedPoint } from "../types.js";
import { HANZI_COORD_SIZE } from "../constants.js";

const CENTER = HANZI_COORD_SIZE / 2;

describe("normalizeCharacterSegment", () => {
  it("returns an empty array for empty input", () => {
    expect(normalizeCharacterSegment([])).toEqual([]);
  });

  it("returns empty stroke arrays when every stroke is empty", () => {
    expect(normalizeCharacterSegment([[], []])).toEqual([[], []]);
  });

  it("collapses a single point to the canvas center", () => {
    const out = normalizeCharacterSegment([[{ x: 17, y: 23, t: 5 }]]);
    expect(out).toEqual([[{ x: CENTER, y: CENTER, t: 5 }]]);
  });

  it("centers the centroid and scales the longer side to HANZI_COORD_SIZE", () => {
    // Square bbox 100x100. Centroid is at (50, 50) (mean of these 4 corners).
    // Longer side is 100, so scale = HANZI_COORD_SIZE / 100.
    const strokes: TimedPoint[][] = [
      [
        { x: 0, y: 0, t: 0 },
        { x: 100, y: 0, t: 1 },
        { x: 100, y: 100, t: 2 },
        { x: 0, y: 100, t: 3 },
      ],
    ];
    const out = normalizeCharacterSegment(strokes);
    const half = HANZI_COORD_SIZE / 2;
    // (0, 0) is top-left in input → after centroid translation (-50, -50) and
    // y-flip → bottom-left in internal (low x, low y? actually centroid moves
    // to center, then x = center - half, y = center + half because Y flips).
    expect(out[0][0].x).toBeCloseTo(CENTER - half);
    expect(out[0][0].y).toBeCloseTo(CENTER + half);
    // (100, 0) input → top-right in input → after y-flip → top-right (high y).
    expect(out[0][1].x).toBeCloseTo(CENTER + half);
    expect(out[0][1].y).toBeCloseTo(CENTER + half);
    // (100, 100) input → bottom-right → high x, low y (Y-up).
    expect(out[0][2].x).toBeCloseTo(CENTER + half);
    expect(out[0][2].y).toBeCloseTo(CENTER - half);
  });

  it("preserves aspect ratio: a tall narrow stroke fits the longer side", () => {
    // Vertical line of 200 px, at x=50. Longer side is 200, so scale = HANZI_COORD_SIZE / 200.
    const strokes: TimedPoint[][] = [
      [
        { x: 50, y: 0, t: 0 },
        { x: 50, y: 200, t: 10 },
      ],
    ];
    const out = normalizeCharacterSegment(strokes);
    // Both points share x=50 → centroid x is 50 → both end at canvas center x.
    expect(out[0][0].x).toBeCloseTo(CENTER);
    expect(out[0][1].x).toBeCloseTo(CENTER);
    // y span fills HANZI_COORD_SIZE: top of the input (y=0, in Y-down) becomes
    // top of internal Y-up (y = HANZI_COORD_SIZE).
    expect(out[0][0].y).toBeCloseTo(HANZI_COORD_SIZE);
    expect(out[0][1].y).toBeCloseTo(0);
  });

  it("preserves timestamps unchanged", () => {
    const strokes: TimedPoint[][] = [
      [
        { x: 0, y: 0, t: 100 },
        { x: 100, y: 100, t: 250 },
      ],
    ];
    const out = normalizeCharacterSegment(strokes);
    expect(out[0][0].t).toBe(100);
    expect(out[0][1].t).toBe(250);
  });

  it("normalizes across multiple strokes consistently (centroid is the joint mean)", () => {
    // Two strokes whose joint bbox is 100x100, joint centroid at (50, 50).
    const strokes: TimedPoint[][] = [
      [
        { x: 0, y: 0, t: 0 },
        { x: 100, y: 0, t: 1 },
      ],
      [
        { x: 0, y: 100, t: 2 },
        { x: 100, y: 100, t: 3 },
      ],
    ];
    const out = normalizeCharacterSegment(strokes);
    // First stroke top edge → high y in Y-up (center + half).
    expect(out[0][0].y).toBeCloseTo(CENTER + HANZI_COORD_SIZE / 2);
    // Second stroke bottom edge → low y in Y-up (center - half).
    expect(out[1][0].y).toBeCloseTo(CENTER - HANZI_COORD_SIZE / 2);
  });

  it("translation invariance: shifted input produces the same normalized output", () => {
    const a: TimedPoint[][] = [
      [
        { x: 0, y: 0, t: 0 },
        { x: 100, y: 100, t: 1 },
      ],
    ];
    const b: TimedPoint[][] = [
      [
        { x: 500, y: 200, t: 0 },
        { x: 600, y: 300, t: 1 },
      ],
    ];
    const outA = normalizeCharacterSegment(a);
    const outB = normalizeCharacterSegment(b);
    expect(outA[0][0].x).toBeCloseTo(outB[0][0].x);
    expect(outA[0][0].y).toBeCloseTo(outB[0][0].y);
    expect(outA[0][1].x).toBeCloseTo(outB[0][1].x);
    expect(outA[0][1].y).toBeCloseTo(outB[0][1].y);
  });

  it("scale invariance: input scaled 2x produces the same normalized output", () => {
    const a: TimedPoint[][] = [
      [
        { x: 0, y: 0, t: 0 },
        { x: 100, y: 100, t: 1 },
      ],
    ];
    const b: TimedPoint[][] = [
      [
        { x: 0, y: 0, t: 0 },
        { x: 200, y: 200, t: 1 },
      ],
    ];
    const outA = normalizeCharacterSegment(a);
    const outB = normalizeCharacterSegment(b);
    expect(outA[0][0].x).toBeCloseTo(outB[0][0].x);
    expect(outA[0][0].y).toBeCloseTo(outB[0][0].y);
    expect(outA[0][1].x).toBeCloseTo(outB[0][1].x);
    expect(outA[0][1].y).toBeCloseTo(outB[0][1].y);
  });
});
