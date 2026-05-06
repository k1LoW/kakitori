import { describe, it, expect } from "vitest";
import { judge } from "./StrokeEndingJudge.js";
import type { StrokeEnding, TimedPoint } from "./types.js";
import { DEFAULT_SIZE } from "./constants.js";

function makeTimedPoints(
  coords: [number, number][],
  intervalMs: number,
  pauseBeforeRelease: number,
): TimedPoint[] {
  // Encode pauseBeforeRelease by appending a final "release" sample at the
  // last position with t = lastMoveT + pauseBeforeRelease.
  const points: TimedPoint[] = coords.map(([x, y], i) => ({
    x,
    y,
    t: i * intervalMs,
  }));
  if (points.length > 0) {
    const last = points[points.length - 1];
    points.push({ x: last.x, y: last.y, t: last.t + pauseBeforeRelease });
  }
  return points;
}

describe("judge", () => {
  describe("tome detection", () => {
    it("detects tome when pause before release is long", () => {
      const points = makeTimedPoints(
        [[0, 0], [10, 10], [20, 20], [30, 30], [40, 40]],
        50,
        100,
      );
      const expected: StrokeEnding = { types: ["tome"] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(true);
      expect(result.velocityProfile).toBe("decelerating");
    });

    it("does not detect tome from a slow final motion segment without a release marker", () => {
      // Low-frequency sampling: the last segment naturally takes longer
      // than the tome threshold (>=80ms), but the user never paused — the
      // last point is just another motion sample (different xy). pauseMs
      // should be 0, not the segment duration, otherwise tome would fire.
      const points: TimedPoint[] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 10, t: 50 },
        { x: 20, y: 20, t: 100 },
        { x: 30, y: 30, t: 250 },
      ];
      const expected: StrokeEnding = { types: ["tome"] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(false);
    });

    it("marks incorrect when tome expected but harai detected", () => {
      // Fast movement (5ms pause) with no sharp turn -> harai
      const points: TimedPoint[] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 10, t: 50 },
        { x: 20, y: 20, t: 100 },
        { x: 30, y: 30, t: 150 },
        { x: 50, y: 50, t: 155 },
      ];
      const expected: StrokeEnding = { types: ["tome"] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(false);
    });
  });

  describe("harai detection", () => {
    it("detects harai when no pause and no sharp turn-with-acceleration", () => {
      const points: TimedPoint[] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 10, t: 50 },
        { x: 20, y: 20, t: 100 },
        { x: 30, y: 30, t: 150 },
        { x: 50, y: 50, t: 155 },
      ];
      const expected: StrokeEnding = { types: ["harai"] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(true);
    });

    it("detects harai even when stroke decelerates (no speed condition)", () => {
      // Slow tip relative to body, no pause, no direction change.
      const points: TimedPoint[] = [];
      for (let i = 0; i < 17; i++) {
        points.push({ x: i * 5, y: i * 5, t: i * 50 });
      }
      points.push({ x: 85, y: 85, t: 1000 });
      points.push({ x: 90, y: 90, t: 1500 });
      points.push({ x: 95, y: 95, t: 1505 });
      const expected: StrokeEnding = { types: ["harai"] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(true);
    });
  });

  describe("hane detection", () => {
    it("detects hane when sharp turn AND tip is faster than body", () => {
      // Stroke going right then flicking up
      const points: TimedPoint[] = [];
      for (let i = 0; i < 17; i++) {
        points.push({ x: i * 5, y: 0, t: i * 50 });
      }
      points.push({ x: 80, y: -10, t: 870 });
      points.push({ x: 80, y: -30, t: 890 });
      points.push({ x: 80, y: -50, t: 895 });
      const expected: StrokeEnding = { types: ["hane"] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(true);
      expect(result.velocityProfile).toBe("accelerating");
    });

    it("does not detect hane when sharp turn but tip is slower than body", () => {
      // Same shape (sharp turn) but tip moves slower than the body.
      const points: TimedPoint[] = [];
      for (let i = 0; i < 17; i++) {
        points.push({ x: i * 5, y: 0, t: i * 50 });
      }
      points.push({ x: 80, y: -10, t: 1500 });
      points.push({ x: 80, y: -20, t: 2500 });
      points.push({ x: 80, y: -30, t: 2505 });
      const expected: StrokeEnding = { types: ["hane"] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(false);
    });

    it("detects hane even when a synthetic release sample is appended", () => {
      // Same hane shape as above but with a synthetic release point at the
      // end (same xy as the last move, only `t` differs). Direction and
      // tail analysis must skip this point or the tip distance and end
      // direction would be wiped out.
      const points: TimedPoint[] = [];
      for (let i = 0; i < 17; i++) {
        points.push({ x: i * 5, y: 0, t: i * 50 });
      }
      points.push({ x: 80, y: -10, t: 870 });
      points.push({ x: 80, y: -30, t: 890 });
      points.push({ x: 80, y: -50, t: 895 });
      // Synthetic release: same xy as the previous sample, only t advances.
      points.push({ x: 80, y: -50, t: 905 });
      const expected: StrokeEnding = { types: ["hane"] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(true);
      expect(result.velocityProfile).toBe("accelerating");
    });

    it("does not detect hane when stroke is straight with pause", () => {
      const points = makeTimedPoints(
        [[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]],
        50,
        100,
      );
      const expected: StrokeEnding = { types: ["hane"] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(false);
    });
  });

  describe("multiple accepted types", () => {
    it("accepts when detected type is one of multiple expected types", () => {
      const points = makeTimedPoints(
        [[0, 0], [10, 10], [20, 20], [30, 30], [40, 40]],
        50,
        100,
      );
      const expected: StrokeEnding = { types: ["tome", "harai"] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(true);
    });
  });

  describe("empty types (skip judgment)", () => {
    it("returns incorrect when types is empty", () => {
      const points = makeTimedPoints([[0, 0], [10, 10]], 50, 0);
      const expected: StrokeEnding = { types: [] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE });
      expect(result.correct).toBe(false);
    });
  });

  describe("direction checking", () => {
    it("validates direction when harai with direction specified", () => {
      const points: TimedPoint[] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 10, t: 50 },
        { x: 20, y: 20, t: 100 },
        { x: 30, y: 30, t: 150 },
        { x: 50, y: 50, t: 155 },
      ];
      const expected: StrokeEnding = {
        types: ["harai"],
        direction: [0.71, 0.71],
      };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("rejects when direction does not match", () => {
      // Points go right
      const points: TimedPoint[] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 0, t: 50 },
        { x: 20, y: 0, t: 100 },
        { x: 30, y: 0, t: 150 },
        { x: 50, y: 0, t: 155 },
      ];
      const expected: StrokeEnding = {
        types: ["harai"],
        direction: [0, 1],
      };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(result.correct).toBe(false);
    });
  });

  describe("confidence", () => {
    it("returns higher confidence for correct judgment", () => {
      const points = makeTimedPoints(
        [[0, 0], [10, 10], [20, 20], [30, 30], [40, 40]],
        50,
        100,
      );
      const correct = judge(points, { types: ["tome"] }, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      const incorrect = judge(points, { types: ["hane"] }, { drawableSize: DEFAULT_SIZE, strictness: 0.7 });
      expect(correct.confidence).toBeGreaterThan(incorrect.confidence);
    });
  });

  describe("drawable size scaling", () => {
    it("detects harai consistently at different drawable sizes", () => {
      const baseAt300: TimedPoint[] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 10, t: 50 },
        { x: 20, y: 20, t: 100 },
        { x: 30, y: 30, t: 150 },
        { x: 50, y: 50, t: 155 },
      ];
      const expected: StrokeEnding = { types: ["harai"] };

      const resultAt300 = judge(baseAt300, expected, { drawableSize: 300, strictness: 0.7 });

      // Scale up to 600px (2x): points and distances double
      const scaledAt600: TimedPoint[] = [
        { x: 0, y: 0, t: 0 },
        { x: 20, y: 20, t: 50 },
        { x: 40, y: 40, t: 100 },
        { x: 60, y: 60, t: 150 },
        { x: 100, y: 100, t: 155 },
      ];

      const resultAt600 = judge(scaledAt600, expected, { drawableSize: 600, strictness: 0.7 });

      expect(resultAt300.correct).toBe(true);
      expect(resultAt600.correct).toBe(true);
    });

    it("detects tome consistently at different drawable sizes", () => {
      const expected: StrokeEnding = { types: ["tome"] };
      const points = makeTimedPoints(
        [[0, 0], [5, 5], [10, 10], [15, 15], [20, 20]],
        50,
        100,
      );

      const resultSmall = judge(points, expected, { drawableSize: 60, strictness: 0.7 });
      const resultLarge = judge(points, expected, { drawableSize: 600, strictness: 0.7 });

      expect(resultSmall.correct).toBe(true);
      expect(resultLarge.correct).toBe(true);
    });

    it("detects hane consistently at different drawable sizes", () => {
      const expected: StrokeEnding = { types: ["hane"] };

      const baseAt300: TimedPoint[] = [
        { x: 0, y: 0, t: 0 },
        { x: 5, y: 0, t: 50 },
        { x: 10, y: 0, t: 100 },
        { x: 15, y: 0, t: 150 },
        { x: 20, y: 0, t: 200 },
        { x: 25, y: 0, t: 250 },
        { x: 30, y: 0, t: 300 },
        { x: 35, y: 0, t: 350 },
        { x: 40, y: 0, t: 400 },
        { x: 45, y: 0, t: 450 },
        { x: 50, y: 0, t: 500 },
        { x: 55, y: 0, t: 550 },
        { x: 60, y: 0, t: 600 },
        { x: 65, y: 0, t: 650 },
        { x: 70, y: 0, t: 700 },
        { x: 75, y: 0, t: 750 },
        { x: 80, y: 0, t: 800 },
        { x: 80, y: -10, t: 820 },
        { x: 80, y: -30, t: 840 },
        { x: 80, y: -50, t: 845 },
      ];

      const scaledAt600: TimedPoint[] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 0, t: 50 },
        { x: 20, y: 0, t: 100 },
        { x: 30, y: 0, t: 150 },
        { x: 40, y: 0, t: 200 },
        { x: 50, y: 0, t: 250 },
        { x: 60, y: 0, t: 300 },
        { x: 70, y: 0, t: 350 },
        { x: 80, y: 0, t: 400 },
        { x: 90, y: 0, t: 450 },
        { x: 100, y: 0, t: 500 },
        { x: 110, y: 0, t: 550 },
        { x: 120, y: 0, t: 600 },
        { x: 130, y: 0, t: 650 },
        { x: 140, y: 0, t: 700 },
        { x: 150, y: 0, t: 750 },
        { x: 160, y: 0, t: 800 },
        { x: 160, y: -20, t: 820 },
        { x: 160, y: -60, t: 840 },
        { x: 160, y: -100, t: 845 },
      ];

      const resultAt300 = judge(baseAt300, expected, { drawableSize: 300, strictness: 0.7 });
      const resultAt600 = judge(scaledAt600, expected, { drawableSize: 600, strictness: 0.7 });

      expect(resultAt300.correct).toBe(true);
      expect(resultAt600.correct).toBe(true);
    });

    it("throws when drawableSize is 0", () => {
      const points = makeTimedPoints([[0, 0], [10, 10]], 50, 0);
      expect(() => judge(points, { types: ["tome"] }, { drawableSize: 0 })).toThrow("drawableSize must be positive");
    });

    it("throws when drawableSize is negative", () => {
      const points = makeTimedPoints([[0, 0], [10, 10]], 50, 0);
      expect(() => judge(points, { types: ["tome"] }, { drawableSize: -100 })).toThrow("drawableSize must be positive");
    });

    it("throws when drawableSize is NaN", () => {
      const points = makeTimedPoints([[0, 0], [10, 10]], 50, 0);
      expect(() => judge(points, { types: ["tome"] }, { drawableSize: Number.NaN })).toThrow("drawableSize must be finite");
    });

    it("throws when drawableSize is Infinity", () => {
      const points = makeTimedPoints([[0, 0], [10, 10]], 50, 0);
      expect(() => judge(points, { types: ["tome"] }, { drawableSize: Number.POSITIVE_INFINITY })).toThrow("drawableSize must be finite");
    });
  });

  describe("timestamp validation", () => {
    it("throws when any point.t is NaN", () => {
      const points: TimedPoint[] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 10, t: Number.NaN },
        { x: 20, y: 20, t: 100 },
      ];
      expect(() =>
        judge(points, { types: ["tome"] }, { drawableSize: DEFAULT_SIZE }),
      ).toThrow("points[1].t must be a finite number");
    });

    it("throws when any point.t is Infinity", () => {
      const points: TimedPoint[] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 10, t: Number.POSITIVE_INFINITY },
      ];
      expect(() =>
        judge(points, { types: ["tome"] }, { drawableSize: DEFAULT_SIZE }),
      ).toThrow("points[1].t must be a finite number");
    });
  });
});
