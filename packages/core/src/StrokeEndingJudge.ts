import type {
  StrokeEnding,
  StrokeEndingJudgment,
  StrokeEndingType,
} from "./types.js";

interface Point {
  x: number;
  y: number;
}

function normalize(dx: number, dy: number): [number, number] {
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) return [0, 0];
  return [dx / mag, dy / mag];
}

function dotProduct(a: [number, number], b: [number, number]): number {
  return a[0] * b[0] + a[1] * b[1];
}

function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export interface StrokeTimingData {
  pauseBeforeRelease: number;
  timedPoints: Array<{ x: number; y: number; t: number }>;
}

function getEndDirection(points: Point[]): [number, number] | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  return normalize(last.x - prev.x, last.y - prev.y);
}

/**
 * Detect the maximum direction change in the tail of the stroke.
 * Compares the direction of the "body" (middle section) vs the "tip" (last section).
 * This is more robust than just looking at the last 3 points, because hane
 * involves a direction change over several points.
 */
function detectDirectionChangeFromTimedPoints(
  timedPoints: Array<{ x: number; y: number; t: number }>,
  minSegmentDist: number,
): number {
  const n = timedPoints.length;
  if (n < 6) return 0;

  // Body direction: stroke's main direction leading up to the tail.
  // Use the segment from 40% to 70% of the stroke.
  const bodyStart = Math.floor(n * 0.4);
  const bodyEnd = Math.floor(n * 0.7);

  // Tip direction: last 15% of the stroke
  const tipStart = Math.floor(n * 0.85);

  const bodyDir = normalize(
    timedPoints[bodyEnd].x - timedPoints[bodyStart].x,
    timedPoints[bodyEnd].y - timedPoints[bodyStart].y,
  );

  const tipDir = normalize(
    timedPoints[n - 1].x - timedPoints[tipStart].x,
    timedPoints[n - 1].y - timedPoints[tipStart].y,
  );

  if (
    distance(timedPoints[bodyStart], timedPoints[bodyEnd]) < minSegmentDist ||
    distance(timedPoints[tipStart], timedPoints[n - 1]) < minSegmentDist
  ) {
    return 0;
  }

  const dot = dotProduct(bodyDir, tipDir);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

// Calibration baseline for threshold scaling. Independent from DEFAULT_SIZE (user-facing default); they may diverge.
const BASE_SIZE = 300;

export interface JudgeOptions {
  drawableSize: number;
  strictness?: number;
  timing?: StrokeTimingData;
}

export function judge(
  drawnPoints: Point[],
  expected: StrokeEnding,
  options: JudgeOptions,
): StrokeEndingJudgment {
  const { drawableSize, strictness = 0.7, timing } = options;
  if (!Number.isFinite(drawableSize)) {
    throw new Error(`judge(): drawableSize must be finite, got ${drawableSize}`);
  }
  if (drawableSize <= 0) {
    throw new Error(`judge(): drawableSize must be positive, got ${drawableSize}`);
  }
  const scale = drawableSize / BASE_SIZE;

  const tailSize = Math.max(3, Math.floor(drawnPoints.length * 0.2));
  const tail = drawnPoints.slice(-tailSize);
  const actualEndDirection = getEndDirection(tail);

  const pauseMs = timing?.pauseBeforeRelease ?? 0;
  const tomeThreshold = 80;
  const hasTomePause = pauseMs >= tomeThreshold;

  // Detect direction change from timed points (more reliable than HW points)
  const minSegmentDist = 3 * scale;
  const directionChange = timing?.timedPoints
    ? detectDirectionChangeFromTimedPoints(timing.timedPoints, minSegmentDist)
    : 0;

  // Compute end velocity from timed points (normalize by scale)
  let endVelocity = 0;
  if (timing && timing.timedPoints.length >= 2) {
    const pts = timing.timedPoints;
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const dt = last.t - prev.t;
    if (dt > 0) {
      endVelocity = distance(last, prev) / dt / scale;
    }
  }

  let velocityProfile: "decelerating" | "constant" | "accelerating" = "constant";
  let detectedType: StrokeEndingType;

  // Tome: user clearly paused before releasing
  if (hasTomePause) {
    detectedType = "tome";
    velocityProfile = "decelerating";
  }
  // Hane: sharp direction change (> 60 degrees) at the end
  else if (directionChange > Math.PI / 3) {
    detectedType = "hane";
  }
  // Harai: no pause, moving at the end
  else if (endVelocity > 0.3) {
    detectedType = "harai";
    velocityProfile = "accelerating";
  }
  // Default: tome
  else {
    detectedType = "tome";
  }

  let correct = (expected.types ?? []).includes(detectedType);
  let confidence = 0.5;

  if (correct) {
    confidence = 0.8;

    if (
      expected.direction != null &&
      actualEndDirection != null &&
      (detectedType === "hane" || detectedType === "harai")
    ) {
      const dirSimilarity = dotProduct(actualEndDirection, expected.direction);
      const threshold = 1 - strictness;
      if (dirSimilarity < threshold) {
        correct = false;
        confidence = 0.3;
      } else {
        confidence = 0.5 + dirSimilarity * 0.5;
      }
    }
  } else {
    confidence = 0.3;
  }

  return {
    correct,
    expected: expected.types,
    confidence,
    velocityProfile,
    actualEndDirection,
  };
}
