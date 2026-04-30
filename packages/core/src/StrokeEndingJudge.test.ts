import { describe, it, expect } from "vitest";
import { judge, type StrokeTimingData } from "./StrokeEndingJudge.js";
import type { StrokeEnding } from "./types.js";
import { DEFAULT_SIZE } from "./constants.js";

function makePoints(coords: [number, number][]): { x: number; y: number }[] {
  return coords.map(([x, y]) => ({ x, y }));
}

function makeTimedPoints(
  coords: [number, number][],
  intervalMs: number,
): StrokeTimingData["timedPoints"] {
  return coords.map(([x, y], i) => ({ x, y, t: i * intervalMs }));
}

describe("judge", () => {
  describe("tome detection", () => {
    it("detects tome when pause before release is long", () => {
      const points = makePoints([
        [0, 0], [10, 10], [20, 20], [30, 30], [40, 40],
      ]);
      const expected: StrokeEnding = { types: ["tome"] };
      const timing: StrokeTimingData = {
        pauseBeforeRelease: 100,
        timedPoints: makeTimedPoints([
          [0, 0], [10, 10], [20, 20], [30, 30], [40, 40],
        ], 50),
      };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7, timing });
      expect(result.correct).toBe(true);
      expect(result.velocityProfile).toBe("decelerating");
    });

    it("marks incorrect when tome expected but harai detected", () => {
      const points = makePoints([
        [0, 0], [10, 10], [20, 20], [30, 30], [40, 40],
      ]);
      const expected: StrokeEnding = { types: ["tome"] };
      // Fast movement (5ms interval) with short pause -> harai detection
      const timedPoints: StrokeTimingData["timedPoints"] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 10, t: 50 },
        { x: 20, y: 20, t: 100 },
        { x: 30, y: 30, t: 150 },
        { x: 50, y: 50, t: 155 },
      ];
      const timing: StrokeTimingData = {
        pauseBeforeRelease: 5,
        timedPoints,
      };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7, timing });
      expect(result.correct).toBe(false);
    });
  });

  describe("harai detection", () => {
    it("detects harai when ending with velocity and no pause", () => {
      const points = makePoints([
        [0, 0], [10, 10], [20, 20], [30, 30], [40, 40],
      ]);
      const expected: StrokeEnding = { types: ["harai"] };
      // Fast movement at the end
      const timedPoints: StrokeTimingData["timedPoints"] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 10, t: 50 },
        { x: 20, y: 20, t: 100 },
        { x: 30, y: 30, t: 150 },
        { x: 50, y: 50, t: 155 },
      ];
      const timing: StrokeTimingData = {
        pauseBeforeRelease: 5,
        timedPoints,
      };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7, timing });
      expect(result.correct).toBe(true);
      expect(result.velocityProfile).toBe("accelerating");
    });
  });

  describe("hane detection", () => {
    it("detects hane when sharp direction change at end", () => {
      // Stroke going right then flicking up
      const points = makePoints([
        [0, 0], [10, 0], [20, 0], [30, 0], [40, 0],
        [50, 0], [60, 0], [65, 0], [68, -10], [68, -30],
      ]);
      const expected: StrokeEnding = { types: ["hane"] };
      // 20 points: body(40%-70%) moves right, tip(85%-end) moves up
      const timedPoints: StrokeTimingData["timedPoints"] = [];
      for (let i = 0; i < 17; i++) {
        timedPoints.push({ x: i * 5, y: 0, t: i * 50 });
      }
      // Last 3 points: flick upward, slow enough to avoid harai (velocity < 0.3)
      timedPoints.push({ x: 80, y: -10, t: 850 + 100 });
      timedPoints.push({ x: 80, y: -30, t: 850 + 200 });
      timedPoints.push({ x: 80, y: -50, t: 850 + 1000 });
      const timing: StrokeTimingData = {
        pauseBeforeRelease: 5,
        timedPoints,
      };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7, timing });
      expect(result.correct).toBe(true);
    });

    it("does not detect hane when stroke is straight with pause", () => {
      const points = makePoints([
        [0, 0], [10, 0], [20, 0], [30, 0], [40, 0],
      ]);
      const expected: StrokeEnding = { types: ["hane"] };
      const timing: StrokeTimingData = {
        pauseBeforeRelease: 100,
        timedPoints: makeTimedPoints([
          [0, 0], [10, 0], [20, 0], [30, 0], [40, 0],
        ], 50),
      };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7, timing });
      expect(result.correct).toBe(false);
    });
  });

  describe("multiple accepted types", () => {
    it("accepts when detected type is one of multiple expected types", () => {
      const points = makePoints([
        [0, 0], [10, 10], [20, 20], [30, 30], [40, 40],
      ]);
      const expected: StrokeEnding = { types: ["tome", "harai"] };
      const timing: StrokeTimingData = {
        pauseBeforeRelease: 100,
        timedPoints: makeTimedPoints([
          [0, 0], [10, 10], [20, 20], [30, 30], [40, 40],
        ], 50),
      };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7, timing });
      expect(result.correct).toBe(true);
    });
  });

  describe("empty types (skip judgment)", () => {
    it("returns incorrect when types is empty", () => {
      const points = makePoints([[0, 0], [10, 10]]);
      const expected: StrokeEnding = { types: [] };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE });
      expect(result.correct).toBe(false);
    });
  });

  describe("direction checking", () => {
    it("validates direction when harai with direction specified", () => {
      const points = makePoints([
        [0, 0], [10, 10], [20, 20], [30, 30], [40, 40],
      ]);
      // Expected direction: down-right
      const expected: StrokeEnding = {
        types: ["harai"],
        direction: [0.71, 0.71],
      };
      const timedPoints: StrokeTimingData["timedPoints"] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 10, t: 50 },
        { x: 20, y: 20, t: 100 },
        { x: 30, y: 30, t: 150 },
        { x: 50, y: 50, t: 155 },
      ];
      const timing: StrokeTimingData = {
        pauseBeforeRelease: 5,
        timedPoints,
      };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7, timing });
      expect(result.correct).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("rejects when direction does not match", () => {
      // Points go right
      const points = makePoints([
        [0, 0], [10, 0], [20, 0], [30, 0], [40, 0],
      ]);
      // Expected direction: straight down
      const expected: StrokeEnding = {
        types: ["harai"],
        direction: [0, 1],
      };
      const timedPoints: StrokeTimingData["timedPoints"] = [
        { x: 0, y: 0, t: 0 },
        { x: 10, y: 0, t: 50 },
        { x: 20, y: 0, t: 100 },
        { x: 30, y: 0, t: 150 },
        { x: 50, y: 0, t: 155 },
      ];
      const timing: StrokeTimingData = {
        pauseBeforeRelease: 5,
        timedPoints,
      };
      const result = judge(points, expected, { drawableSize: DEFAULT_SIZE, strictness: 0.7, timing });
      expect(result.correct).toBe(false);
    });
  });

  describe("confidence", () => {
    it("returns higher confidence for correct judgment", () => {
      const points = makePoints([
        [0, 0], [10, 10], [20, 20], [30, 30], [40, 40],
      ]);
      const timing: StrokeTimingData = {
        pauseBeforeRelease: 100,
        timedPoints: makeTimedPoints([
          [0, 0], [10, 10], [20, 20], [30, 30], [40, 40],
        ], 50),
      };
      const correct = judge(points, { types: ["tome"] }, { drawableSize: DEFAULT_SIZE, strictness: 0.7, timing });
      const incorrect = judge(points, { types: ["hane"] }, { drawableSize: DEFAULT_SIZE, strictness: 0.7, timing });
      expect(correct.confidence).toBeGreaterThan(incorrect.confidence);
    });
  });

  describe("canvas size scaling", () => {
    it("detects harai consistently at different canvas sizes", () => {
      // Base data at 300px
      const basePoints = makePoints([
        [0, 0], [10, 10], [20, 20], [30, 30], [40, 40],
      ]);
      const baseTiming: StrokeTimingData = {
        pauseBeforeRelease: 5,
        timedPoints: [
          { x: 0, y: 0, t: 0 },
          { x: 10, y: 10, t: 50 },
          { x: 20, y: 20, t: 100 },
          { x: 30, y: 30, t: 150 },
          { x: 50, y: 50, t: 155 },
        ],
      };
      const expected: StrokeEnding = { types: ["harai"] };

      const resultAt300 = judge(basePoints, expected, { drawableSize: 300, strictness: 0.7, timing: baseTiming });

      // Scale up to 600px (2x): points and distances double
      const scaledPoints = makePoints([
        [0, 0], [20, 20], [40, 40], [60, 60], [80, 80],
      ]);
      const scaledTiming: StrokeTimingData = {
        pauseBeforeRelease: 5,
        timedPoints: [
          { x: 0, y: 0, t: 0 },
          { x: 20, y: 20, t: 50 },
          { x: 40, y: 40, t: 100 },
          { x: 60, y: 60, t: 150 },
          { x: 100, y: 100, t: 155 },
        ],
      };

      const resultAt600 = judge(scaledPoints, expected, { drawableSize: 600, strictness: 0.7, timing: scaledTiming });

      expect(resultAt300.correct).toBe(true);
      expect(resultAt600.correct).toBe(true);
    });

    it("detects tome consistently at different canvas sizes", () => {
      const expected: StrokeEnding = { types: ["tome"] };
      const timing: StrokeTimingData = {
        pauseBeforeRelease: 100,
        timedPoints: makeTimedPoints([
          [0, 0], [5, 5], [10, 10], [15, 15], [20, 20],
        ], 50),
      };
      const points = makePoints([
        [0, 0], [5, 5], [10, 10], [15, 15], [20, 20],
      ]);

      const resultSmall = judge(points, expected, { drawableSize: 60, strictness: 0.7, timing });
      const resultLarge = judge(points, expected, { drawableSize: 600, strictness: 0.7, timing });

      expect(resultSmall.correct).toBe(true);
      expect(resultLarge.correct).toBe(true);
    });

    it("detects hane consistently at different canvas sizes", () => {
      const expected: StrokeEnding = { types: ["hane"] };

      const basePoints = makePoints([
        [0, 0], [10, 0], [20, 0], [30, 0], [40, 0],
        [50, 0], [60, 0], [65, 0], [68, -10], [68, -30],
      ]);
      const baseTiming: StrokeTimingData = {
        pauseBeforeRelease: 5,
        timedPoints: [
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
          { x: 80, y: -10, t: 950 },
          { x: 80, y: -30, t: 1050 },
          { x: 80, y: -50, t: 1850 },
        ],
      };

      const scaledPoints = makePoints([
        [0, 0], [20, 0], [40, 0], [60, 0], [80, 0],
        [100, 0], [120, 0], [130, 0], [136, -20], [136, -60],
      ]);
      const scaledTiming: StrokeTimingData = {
        pauseBeforeRelease: 5,
        timedPoints: [
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
          { x: 160, y: -20, t: 950 },
          { x: 160, y: -60, t: 1050 },
          { x: 160, y: -100, t: 1850 },
        ],
      };

      const resultAt300 = judge(basePoints, expected, { drawableSize: 300, strictness: 0.7, timing: baseTiming });
      const resultAt600 = judge(scaledPoints, expected, { drawableSize: 600, strictness: 0.7, timing: scaledTiming });

      expect(resultAt300.correct).toBe(true);
      expect(resultAt600.correct).toBe(true);
    });

    it("throws when canvasSize is 0", () => {
      const points = makePoints([[0, 0], [10, 10]]);
      expect(() => judge(points, { types: ["tome"] }, { drawableSize: 0 })).toThrow("drawableSize must be positive");
    });

    it("throws when canvasSize is negative", () => {
      const points = makePoints([[0, 0], [10, 10]]);
      expect(() => judge(points, { types: ["tome"] }, { drawableSize: -100 })).toThrow("drawableSize must be positive");
    });

    it("throws when canvasSize is NaN", () => {
      const points = makePoints([[0, 0], [10, 10]]);
      expect(() => judge(points, { types: ["tome"] }, { drawableSize: Number.NaN })).toThrow("drawableSize must be finite");
    });

    it("throws when canvasSize is Infinity", () => {
      const points = makePoints([[0, 0], [10, 10]]);
      expect(() => judge(points, { types: ["tome"] }, { drawableSize: Number.POSITIVE_INFINITY })).toThrow("drawableSize must be finite");
    });
  });
});
