import type {
  StrokeEnding,
  StrokeEndingResult,
  TimedPoint,
} from "./types.js";
import { checkStrokeEnding } from "./StrokeEndingChecker.js";
import type { CharLogger } from "./charOptions.js";
import type { HanziCharacterData, Pt } from "./hanziWriterInternals.js";
import { findDataStroke, type StrokeGroups } from "./strokeGroups.js";

export function computeDirectionFromMedian(
  points: ReadonlyArray<Pt>,
): [number, number] | null {
  if (points.length < 2) {
    return null;
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) {
    return null;
  }
  return [
    Math.round((dx / mag) * 100) / 100,
    Math.round((dy / mag) * 100) / 100,
  ];
}

export interface EndingCheckInput {
  /** Data-stroke index (hanzi-writer's perspective). */
  dataStrokeNum: number;
  /** Points the user actually drew, in hanzi-writer coord space, with timestamps. */
  points: ReadonlyArray<TimedPoint>;
  /** Configured stroke endings (logical-stroke indexed). */
  strokeEndings: readonly StrokeEnding[] | null;
  /** Logical→data stroke grouping. Null = identity (1:1). */
  strokeGroups: StrokeGroups | null;
  /** Loaded hanzi-writer character data, used for direction auto-compute. */
  characterData: HanziCharacterData | null;
  /**
   * Side length of the drawable area in the SAME coord space as `points`.
   * For internal-coord callers (the default — `Char.checkStroke` and the mounted
   * quiz path both project into hanzi-writer internal coords) this is
   * `HANZI_PRESCALED_SIZE`. For callers passing CSS-pixel points it is
   * the displayed size minus padding (`size - 2 * padding`). Mismatched
   * units here will skew the speed / distance thresholds in
   * {@link StrokeEndingChecker.checkStroke}.
   */
  drawableSize: number;
  /** Stroke ending strictness in [0, 1]. */
  strictness: number;
  log?: CharLogger | null;
}

/**
 * Pure check: given a drawn stroke + config, decide whether the stroke
 * ending matches the expected types. Returns null when check does not
 * apply (no config, mid-group stroke, or empty `types`).
 *
 * Has no side effects beyond optional logger calls; safe to unit-test
 * without standing up a HanziWriter instance.
 */
export function computeEndingCheck(
  input: EndingCheckInput,
): StrokeEndingResult | null {
  const {
    dataStrokeNum,
    points,
    strokeEndings,
    strokeGroups,
    characterData,
    drawableSize,
    strictness,
    log,
  } = input;

  if (!strokeEndings) {
    return null;
  }

  // When strokeGroups is configured, only the first stroke of a group
  // triggers check. Without groups, every stroke is its own logical
  // stroke (1:1) so check always applies.
  let logicalStrokeNum: number;
  let group: readonly number[] | null = null;
  if (strokeGroups) {
    const found = findDataStroke(strokeGroups, dataStrokeNum);
    if (!found || found.pos !== 0) {
      return null;
    }
    logicalStrokeNum = found.logical;
    group = found.group;
  } else {
    logicalStrokeNum = dataStrokeNum;
  }

  const expected = strokeEndings[logicalStrokeNum];
  if (!expected?.types || expected.types.length === 0) {
    return null;
  }

  let resolvedExpected: StrokeEnding = expected;
  const needsDirection =
    expected.types.includes("hane") || expected.types.includes("harai");
  if (expected.direction == null && needsDirection) {
    // Auto-direction: read the median's last segment for the *last* data
    // stroke in the logical group (hane/harai endings live on the final
    // data stroke even when multiple data strokes collapse into one logical
    // stroke).
    const lastDataIdx = group ? group[group.length - 1] : dataStrokeNum;
    const medianPoints = characterData?.strokes[lastDataIdx]?.points;
    const autoDir = medianPoints
      ? computeDirectionFromMedian(medianPoints)
      : null;
    if (autoDir) {
      resolvedExpected = { ...expected, direction: autoDir };
      log?.(`auto direction: stroke=${logicalStrokeNum + 1} dir=[${autoDir}]`);
    }
  }

  // Match StrokeEndingChecker.checkStroke()'s release-marker detection so the log
  // does not report a misleading "pause" for motion-only sequences (where
  // the final dt is just the last segment, not a pointerup pause).
  const lastIsRelease =
    points.length >= 2 &&
    points[points.length - 1].x === points[points.length - 2].x &&
    points[points.length - 1].y === points[points.length - 2].y;
  const pauseBeforeRelease = lastIsRelease
    ? Math.max(0, points[points.length - 1].t - points[points.length - 2].t)
    : 0;
  log?.(
    `check input: pause=${pauseBeforeRelease.toFixed(0)}ms points=${points.length}`,
  );

  const result = checkStrokeEnding(points, resolvedExpected, {
    drawableSize,
    strictness,
  });

  log?.(
    `check result: stroke=${logicalStrokeNum + 1} detected=${
      result.correct ? expected.types : "other"
    } expected=${expected.types} correct=${result.correct} confidence=${result.confidence.toFixed(
      2,
    )} velocity=${result.velocityProfile}`,
  );

  return result;
}
