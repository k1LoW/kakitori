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
  if (mag === 0) {
    return [0, 0];
  }
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
  if (points.length < 2) {
    return null;
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  return normalize(last.x - prev.x, last.y - prev.y);
}

interface TailAnalysis {
  directionChange: number;
  bodySpeed: number;
  tipSpeed: number;
}

/**
 * Analyze the tail of the stroke: direction change and per-segment speed.
 * Body covers 40%-70% of the stroke; tip covers 85%-end. Comparing these two
 * windows is more robust than just inspecting the last 3 points, because hane
 * involves a direction change spanning several points.
 *
 * Speeds are normalized by scale so thresholds stay invariant across drawable sizes.
 */
function analyzeTailFromTimedPoints(
  timedPoints: Array<{ x: number; y: number; t: number }>,
  minSegmentDist: number,
  scale: number,
): TailAnalysis {
  const empty: TailAnalysis = { directionChange: 0, bodySpeed: 0, tipSpeed: 0 };
  const n = timedPoints.length;
  if (n < 6) {
    return empty;
  }
  const bodyStart = Math.floor(n * 0.4);
  const bodyEnd = Math.floor(n * 0.7);
  const tipStart = Math.floor(n * 0.85);

  const bodyDist = distance(timedPoints[bodyStart], timedPoints[bodyEnd]);
  const tipDist = distance(timedPoints[tipStart], timedPoints[n - 1]);

  if (bodyDist < minSegmentDist || tipDist < minSegmentDist) {
    return empty;
  }

  const bodyDir = normalize(
    timedPoints[bodyEnd].x - timedPoints[bodyStart].x,
    timedPoints[bodyEnd].y - timedPoints[bodyStart].y,
  );
  const tipDir = normalize(
    timedPoints[n - 1].x - timedPoints[tipStart].x,
    timedPoints[n - 1].y - timedPoints[tipStart].y,
  );

  const dot = dotProduct(bodyDir, tipDir);
  const directionChange = Math.acos(Math.max(-1, Math.min(1, dot)));

  const bodyDt = timedPoints[bodyEnd].t - timedPoints[bodyStart].t;
  const tipDt = timedPoints[n - 1].t - timedPoints[tipStart].t;
  const bodySpeed = bodyDt > 0 ? bodyDist / bodyDt / scale : 0;
  const tipSpeed = tipDt > 0 ? tipDist / tipDt / scale : 0;

  return { directionChange, bodySpeed, tipSpeed };
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
  const drawnTail = drawnPoints.slice(-tailSize);
  const actualEndDirection = getEndDirection(drawnTail);

  const pauseMs = timing?.pauseBeforeRelease ?? 0;
  const tomeThreshold = 80;
  const hasTomePause = pauseMs >= tomeThreshold;

  const minSegmentDist = 3 * scale;
  const tail = timing?.timedPoints
    ? analyzeTailFromTimedPoints(timing.timedPoints, minSegmentDist, scale)
    : { directionChange: 0, bodySpeed: 0, tipSpeed: 0 };

  let velocityProfile: "decelerating" | "constant" | "accelerating" = "constant";
  let detectedType: StrokeEndingType;

  // Tome: user clearly paused before releasing.
  // Hane: sharp turn (>= 90deg) AND the post-turn (tip) speed exceeds the
  //       pre-turn (body) speed. The acceleration check is what separates a
  //       deliberate flick from a slow corner that just trails off.
  // Harai: anything else (no speed condition required).
  if (hasTomePause) {
    detectedType = "tome";
    velocityProfile = "decelerating";
  } else if (
    tail.directionChange >= Math.PI / 2 &&
    tail.tipSpeed > tail.bodySpeed
  ) {
    detectedType = "hane";
    velocityProfile = "accelerating";
  } else {
    detectedType = "harai";
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
