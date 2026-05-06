import type {
  StrokeEnding,
  StrokeEndingJudgment,
  StrokeEndingType,
  TimedPoint,
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
  timedPoints: ReadonlyArray<TimedPoint>,
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
  /**
   * Side length of the drawable area in the SAME coord space as `points`.
   * Use `HANZI_COORD_SIZE` when `points` are in hanzi-writer internal
   * coords; pass display pixels (e.g. `size - 2 * padding`) only when
   * `points` are in display coords. Speed and segment-distance thresholds
   * scale against this; mismatched units skew the verdict.
   */
  drawableSize: number;
  strictness?: number;
}

export function judge(
  points: ReadonlyArray<TimedPoint>,
  expected: StrokeEnding,
  options: JudgeOptions,
): StrokeEndingJudgment {
  const { drawableSize, strictness = 0.7 } = options;
  if (!Number.isFinite(drawableSize)) {
    throw new Error(`judge(): drawableSize must be finite, got ${drawableSize}`);
  }
  if (drawableSize <= 0) {
    throw new Error(`judge(): drawableSize must be positive, got ${drawableSize}`);
  }
  // Boundary validation: NaN / Infinity in `t` would propagate through
  // pauseMs and the tail-speed calculations and silently produce wrong
  // verdicts. The mount path only ever feeds in performance.now() values, so
  // this guards external callers of judgeStrokeEnding (and Char.judge by
  // extension). Monotonicity is intentionally NOT required — the tail-speed
  // math already floors negative dt to 0.
  for (let i = 0; i < points.length; i++) {
    if (!Number.isFinite(points[i].t)) {
      throw new Error(
        `judge(): points[${i}].t must be a finite number, got ${points[i].t}`,
      );
    }
  }
  const scale = drawableSize / BASE_SIZE;

  // The convention: when the final element of `points` shares its xy with
  // the previous sample, it is treated as the moment of pointerup; the gap
  // between their timestamps is the user's pause before releasing. When
  // the last point is just another motion sample (xy differs), the final
  // segment duration is NOT a pause and would produce false tome detections
  // on low-frequency sampling, so we report 0.
  //
  // The same condition decides whether direction and tail analysis should
  // skip the last sample: a synthetic release point at the same xy makes
  // getEndDirection() return [0, 0] and lets the tip window in
  // analyzeTailFromTimedPoints() collapse the tip distance / dilute tip
  // speed with the pause duration. Motion-only sequences are analyzed in
  // full.
  const lastIsRelease =
    points.length >= 2 &&
    points[points.length - 1].x === points[points.length - 2].x &&
    points[points.length - 1].y === points[points.length - 2].y;
  const pauseMs = lastIsRelease
    ? Math.max(0, points[points.length - 1].t - points[points.length - 2].t)
    : 0;
  const tomeThreshold = 80;
  const hasTomePause = pauseMs >= tomeThreshold;

  const motionPoints = lastIsRelease ? points.slice(0, -1) : points;

  const tailSize = Math.max(3, Math.floor(motionPoints.length * 0.2));
  const drawnTail = motionPoints.slice(-tailSize);
  const actualEndDirection = getEndDirection(drawnTail);

  const minSegmentDist = 3 * scale;
  const tail = analyzeTailFromTimedPoints(motionPoints, minSegmentDist, scale);

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
