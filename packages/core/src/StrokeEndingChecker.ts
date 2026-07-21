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
 * Euclidean radius around the release point that counts as "held still",
 * in the same units as the `points` supplied to `findStationaryTailStart`
 * / `checkStrokeEnding` (typically hanzi-writer internal coords, so
 * HANZI_PRESCALED_SIZE=1024, but display coords are also permitted per
 * `CheckOptions.drawableSize`). Not scaled by `drawableSize` — the
 * numeric value applies literally to whatever coord space the caller
 * uses.
 *
 * Why anchor-based, not per-step. The prior implementation walked back
 * with a per-step axis-aligned `|Δ| ≤ 2` test. That form fails on
 * tension-driven tremor: when a small child presses hard trying to hold
 * a tome, the finger oscillates by 3..6 units per sample around the
 * intended endpoint. A single sample whose Δ exceeds the tolerance
 * shatters the cluster even when the finger is net-stationary, so
 * deliberate tome drops to harai. Anchoring on the last sample and
 * accepting any point within `NEIGHBORHOOD_RADIUS` of it absorbs
 * arbitrary oscillation patterns (jitter, zig-zag, symmetric bounce)
 * as long as the finger stays inside that neighborhood.
 *
 * Why 8. Empirically calibrated against the hane data in
 * `@k1low/hanzi-writer-data-jp`: the shortest designed hane "tip"
 * (85%..end of the median) across the 163 hane strokes shipped in
 * `packages/data` is ~65 units, so R=8 leaves an 88% safety margin
 * before neighborhood eats into a real hane flick. On the tremor
 * side, 8 units ≈ 2.4 CSS px on a 300 px display (0.78 % of a
 * 1024-coord canvas) — comfortably above the amplitude of a
 * pressed-down fingertip's involuntary shake, comfortably below a
 * deliberate hane flick. Slow, deliberate slides into the endpoint
 * shift slightly toward being read as tome; that's an accepted
 * trade-off because "stopped in the neighborhood" IS the design intent
 * of tome here.
 */
const NEIGHBORHOOD_RADIUS = 8;
const NEIGHBORHOOD_RADIUS_SQ = NEIGHBORHOOD_RADIUS * NEIGHBORHOOD_RADIUS;

/**
 * Walk backwards from the last sample and return the index of the first
 * sample that still sits inside the release-point neighborhood — the
 * boundary between motion and the trailing pause cluster. A sample
 * counts as "held still" when its Euclidean distance from the last
 * sample is `≤ NEIGHBORHOOD_RADIUS`, regardless of the per-step
 * direction, so oscillation around the endpoint (a hand trembling
 * while holding a tome) accumulates as one cluster instead of being
 * shattered by any single outlying step.
 *
 * The returned index is `points.length - 1` when there is no stationary
 * tail (the very last sample is a real motion sample, i.e. the sample
 * before it lies outside the neighborhood), so callers can detect that
 * case with `motionEndIdx < points.length - 1`.
 *
 * Exported so debug/logging paths can report the SAME pause the checker
 * uses, instead of recomputing with a stale definition.
 */
export function findStationaryTailStart(
  points: ReadonlyArray<TimedPoint>,
): number {
  const n = points.length;
  if (n === 0) {
    return 0;
  }
  const last = points[n - 1];
  let i = n - 1;
  while (i > 0) {
    const dx = points[i - 1].x - last.x;
    const dy = points[i - 1].y - last.y;
    if (dx * dx + dy * dy > NEIGHBORHOOD_RADIUS_SQ) {
      break;
    }
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

  // Trailing samples that sit within NEIGHBORHOOD_RADIUS of the release
  // point are treated as the user holding still before release; see
  // findStationaryTailStart() for the rationale and radius choice.
  // motionPoints drops that cluster before tail analysis: keeping
  // stationary samples in the tip window collapses tip distance and
  // dilutes tip speed with the pause duration, and pollutes
  // getEndDirection() with a near-zero vector.
  const motionEndIdx = findStationaryTailStart(points);
  const hasStationaryTail = motionEndIdx < points.length - 1;
  const pauseMs = hasStationaryTail
    ? Math.max(0, points[points.length - 1].t - points[motionEndIdx].t)
    : 0;
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
      // `expected.direction` is rounded to 2 decimal places in
      // computeDirectionFromMedian() and unit-vector validation on stored
      // data only requires |mag - 1| < 0.1, so the raw dot product can drift
      // slightly outside [-1, 1]. Clamp before feeding it into the confidence
      // formula so `confidence` stays inside its documented `[0, 1]` range.
      const dirSimilarity = Math.max(
        -1,
        Math.min(1, dotProduct(actualEndDirection, expected.direction)),
      );
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
