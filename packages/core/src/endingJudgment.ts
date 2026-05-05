import type { StrokeEnding, StrokeEndingJudgment } from "./types.js";
import { judge, type StrokeTimingData } from "./StrokeEndingJudge.js";
import type { CharLogger } from "./charOptions.js";

export function computeDirectionFromMedian(
  points: Array<{ x: number; y: number }>,
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

/** Position of a data-stroke index within its strokeGroup, or null if unmapped. */
function findGroupPosition(
  strokeGroups: number[][] | null,
  dataStrokeNum: number,
): { logical: number; pos: number; group: number[] } | null {
  if (!strokeGroups) {
    return null;
  }
  for (let logical = 0; logical < strokeGroups.length; logical++) {
    const group = strokeGroups[logical];
    const pos = group.indexOf(dataStrokeNum);
    if (pos >= 0) {
      return { logical, pos, group };
    }
  }
  return null;
}

export interface EndingJudgmentInput {
  /** Data-stroke index (hanzi-writer's perspective). */
  dataStrokeNum: number;
  /** Points the user actually drew, in hanzi-writer coord space. */
  drawnPoints: Array<{ x: number; y: number }>;
  /** Pointer-derived timing for the same stroke. */
  timing: StrokeTimingData;
  /** Configured stroke endings (logical-stroke indexed). */
  strokeEndings: readonly StrokeEnding[] | null;
  /** Logical→data stroke grouping. Null = identity (1:1). */
  strokeGroups: readonly number[][] | null;
  /** Loaded hanzi-writer character data, used for direction auto-compute. */
  characterData: {
    strokes: ReadonlyArray<{ points?: ReadonlyArray<{ x: number; y: number }> }>;
  } | null;
  /** Pixel size of the drawable area (size - 2 * padding). */
  drawableSize: number;
  /** Stroke ending strictness in [0, 1]. */
  strictness: number;
  log?: CharLogger | null;
}

/**
 * Pure judgment: given a drawn stroke + config, decide whether the stroke
 * ending matches the expected types. Returns null when judgment does not
 * apply (no config, mid-group stroke, or empty `types`).
 *
 * Has no side effects beyond optional logger calls; safe to unit-test
 * without standing up a HanziWriter instance.
 */
export function computeEndingJudgment(
  input: EndingJudgmentInput,
): StrokeEndingJudgment | null {
  const {
    dataStrokeNum,
    drawnPoints,
    timing,
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
  // triggers judgment. Without groups, every stroke is its own logical
  // stroke (1:1) so judgment always applies.
  let logicalStrokeNum: number;
  let group: readonly number[] | null = null;
  if (strokeGroups) {
    const found = findGroupPosition(strokeGroups as number[][], dataStrokeNum);
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
      ? computeDirectionFromMedian(medianPoints as Array<{ x: number; y: number }>)
      : null;
    if (autoDir) {
      resolvedExpected = { ...expected, direction: autoDir };
      log?.(`auto direction: stroke=${logicalStrokeNum + 1} dir=[${autoDir}]`);
    }
  }

  log?.(
    `judge input: pause=${timing.pauseBeforeRelease.toFixed(0)}ms timedPoints=${timing.timedPoints.length} hwPoints=${drawnPoints.length}`,
  );

  const judgment = judge(drawnPoints, resolvedExpected, {
    drawableSize,
    strictness,
    timing,
  });

  log?.(
    `judge result: stroke=${logicalStrokeNum + 1} detected=${
      judgment.correct ? expected.types : "other"
    } expected=${expected.types} correct=${judgment.correct} confidence=${judgment.confidence.toFixed(
      2,
    )} velocity=${judgment.velocityProfile}`,
  );

  return judgment;
}
