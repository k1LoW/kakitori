import { describe, it, expect } from "vitest";
import { normalizeCharacterSegment } from "./normalize.js";
import type { TimedPoint } from "../types.js";
import {
  HANZI_PRESCALED_SIZE,
  HANZI_Y_MAX,
  HANZI_Y_MIN,
} from "../constants.js";

// Internal canvas is asymmetric: X ∈ [0, HANZI_PRESCALED_SIZE], Y ∈
// [HANZI_Y_MIN, HANZI_Y_MAX]. The default normalize target centers
// accordingly, so the X center is 512 and the Y center is 388, not the
// same value.
const CENTER_X = HANZI_PRESCALED_SIZE / 2;
const CENTER_Y = (HANZI_Y_MIN + HANZI_Y_MAX) / 2;

describe("normalizeCharacterSegment", () => {
  it("returns an empty array for empty input", () => {
    expect(normalizeCharacterSegment([])).toEqual([]);
  });

  it("returns empty stroke arrays when every stroke is empty", () => {
    expect(normalizeCharacterSegment([[], []])).toEqual([[], []]);
  });

  it("collapses a single point to the canvas center", () => {
    const out = normalizeCharacterSegment([[{ x: 17, y: 23, t: 5 }]]);
    expect(out).toEqual([[{ x: CENTER_X, y: CENTER_Y, t: 5 }]]);
  });

  it("centers the centroid and scales the longer side to HANZI_PRESCALED_SIZE", () => {
    // Square bbox 100x100. Centroid is at (50, 50) (mean of these 4 corners).
    // Longer side is 100, so scale = HANZI_PRESCALED_SIZE / 100.
    const strokes: TimedPoint[][] = [
      [
        { x: 0, y: 0, t: 0 },
        { x: 100, y: 0, t: 1 },
        { x: 100, y: 100, t: 2 },
        { x: 0, y: 100, t: 3 },
      ],
    ];
    const out = normalizeCharacterSegment(strokes);
    const halfX = HANZI_PRESCALED_SIZE / 2;
    // (0, 0) is top-left in input → centroid translation (-50, -50) and y-flip
    // place it at (CENTER_X - halfX, HANZI_Y_MAX) (low x, top of Y-up canvas).
    expect(out[0][0].x).toBeCloseTo(CENTER_X - halfX);
    expect(out[0][0].y).toBeCloseTo(HANZI_Y_MAX);
    // (100, 0) input → top-right → high x, top of Y-up canvas.
    expect(out[0][1].x).toBeCloseTo(CENTER_X + halfX);
    expect(out[0][1].y).toBeCloseTo(HANZI_Y_MAX);
    // (100, 100) input → bottom-right → high x, bottom of Y-up canvas.
    expect(out[0][2].x).toBeCloseTo(CENTER_X + halfX);
    expect(out[0][2].y).toBeCloseTo(HANZI_Y_MIN);
  });

  it("preserves aspect ratio: a tall narrow stroke fits the longer side", () => {
    // Vertical line of 200 px, at x=50. Longer side is 200, so scale = HANZI_PRESCALED_SIZE / 200.
    const strokes: TimedPoint[][] = [
      [
        { x: 50, y: 0, t: 0 },
        { x: 50, y: 200, t: 10 },
      ],
    ];
    const out = normalizeCharacterSegment(strokes);
    // Both points share x=50 → centroid x is 50 → both end at canvas center x.
    expect(out[0][0].x).toBeCloseTo(CENTER_X);
    expect(out[0][1].x).toBeCloseTo(CENTER_X);
    // y span fills HANZI_PRESCALED_SIZE: top of the input (y=0, in Y-down) lands
    // at HANZI_Y_MAX (top of Y-up canvas); the bottom of the input lands at
    // HANZI_Y_MIN (descender). The full asymmetric Y range is covered.
    expect(out[0][0].y).toBeCloseTo(HANZI_Y_MAX);
    expect(out[0][1].y).toBeCloseTo(HANZI_Y_MIN);
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
    // First stroke top edge → top of Y-up canvas (HANZI_Y_MAX).
    expect(out[0][0].y).toBeCloseTo(HANZI_Y_MAX);
    // Second stroke bottom edge → bottom of Y-up canvas (HANZI_Y_MIN).
    expect(out[1][0].y).toBeCloseTo(HANZI_Y_MIN);
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
