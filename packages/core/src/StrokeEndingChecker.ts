import type {
  StrokeEnding,
  StrokeEndingResult,
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

/**
 * Walk backwards from the last sample and return the index of the first
 * "stationary" sample — the boundary between motion and the trailing
 * pause cluster. Consecutive steps whose `|Δx| ≤ 1` and `|Δy| ≤ 1` are
 * treated as the user holding still: the ±1 tolerance absorbs sub-pixel
 * jitter that pointer devices keep emitting while the finger is stopped.
 *
 * The returned index is `points.length - 1` when there is no stationary
 * tail (the very last sample is a real motion sample), so callers can
 * detect that case with `motionEndIdx < points.length - 1`.
 *
 * Exported so debug/logging paths can report the SAME pause the checker
 * uses, instead of recomputing with a stale exact-match definition.
 */
export function findStationaryTailStart(
  points: ReadonlyArray<TimedPoint>,
): number {
  let i = points.length - 1;
  while (
    i > 0 &&
    Math.abs(points[i].x - points[i - 1].x) <= 1 &&
    Math.abs(points[i].y - points[i - 1].y) <= 1
  ) {
    i--;
  }
  return i;
}

/**
 * Time the user spent holding still at the end of `points`, in
 * milliseconds. Zero when there is no stationary cluster (the final
 * sample is a real motion sample).
 */
export function computeTailPauseMs(points: ReadonlyArray<TimedPoint>): number {
  if (points.length < 2) {
    return 0;
  }
  const motionEndIdx = findStationaryTailStart(points);
  if (motionEndIdx >= points.length - 1) {
    return 0;
  }
  return Math.max(0, points[points.length - 1].t - points[motionEndIdx].t);
}

export interface CheckOptions {
  /**
   * Side length of the drawable area in the SAME coord space as `points`.
   * Use `HANZI_PRESCALED_SIZE` when `points` are in hanzi-writer internal
   * coords; pass display pixels (e.g. `size - 2 * padding`) only when
   * `points` are in display coords. Speed and segment-distance thresholds
   * scale against this; mismatched units skew the verdict.
   */
  drawableSize: number;
  strictness?: number;
}

export function checkStrokeEnding(
  points: ReadonlyArray<TimedPoint>,
  expected: StrokeEnding,
  options: CheckOptions,
): StrokeEndingResult {
  const { drawableSize, strictness = 0.7 } = options;
  if (!Number.isFinite(drawableSize)) {
    throw new Error(`checkStrokeEnding(): drawableSize must be finite, got ${drawableSize}`);
  }
  if (drawableSize <= 0) {
    throw new Error(`checkStrokeEnding(): drawableSize must be positive, got ${drawableSize}`);
  }
  // Boundary validation: NaN / Infinity in any field would propagate
  // through pauseMs, distance, normalize and the tail-speed calculations
  // and silently produce wrong verdicts (e.g. directionChange = NaN falls
  // through to harai). The mount path only ever feeds finite values, so
  // this guards external callers of checkStrokeEnding (and Char.checkStroke by
  // extension). Monotonicity is intentionally NOT required — the tail-speed
  // math already floors negative dt to 0.
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.t)) {
      throw new Error(
        `check(): points[${i}] must have finite x/y/t, got x=${p.x} y=${p.y} t=${p.t}`,
      );
    }
  }
  const scale = drawableSize / BASE_SIZE;

  // Trailing samples whose xy stays within 1 unit of the previous sample
  // are treated as the user holding still before release; see
  // findStationaryTailStart() for the rationale and tolerance choice.
  // motionPoints drops that cluster before tail analysis: keeping
  // stationary samples in the tip window collapses tip distance and
  // dilutes tip speed with the pause duration, and pollutes
  // getEndDirection() with a near-zero vector.
  const motionEndIdx = findStationaryTailStart(points);
  const hasStationaryTail = motionEndIdx < points.length - 1;
  const pauseMs = computeTailPauseMs(points);
  const tomeThreshold = 80;
  const hasTomePause = pauseMs >= tomeThreshold;

  const motionPoints = hasStationaryTail ? points.slice(0, motionEndIdx + 1) : points;

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
