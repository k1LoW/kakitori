/**
 * StrokeGroups maps **logical strokes** (what the user perceives, e.g. "あ"
 * is 3 strokes) to **data strokes** (hanzi-writer's underlying definition,
 * which may split a logical stroke into multiple paths). Each entry is the
 * data-stroke indices that compose one logical stroke, in stroke order.
 *
 * Example: `[[0], [1], [2, 3]]` means data strokes 2 and 3 are drawn
 * together as the third logical stroke.
 */
export type StrokeGroups = readonly (readonly number[])[];

export interface DataStrokeLocation {
  logical: number;
  pos: number;
  group: readonly number[];
}

/** Locate a data stroke within strokeGroups. Null when unmapped. */
export function findDataStroke(
  strokeGroups: StrokeGroups | null,
  dataStrokeNum: number,
): DataStrokeLocation | null {
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

/**
 * Logical stroke index for a given data stroke. Falls back to the data
 * stroke index itself when `strokeGroups` is null or does not map the
 * stroke (e.g. incomplete groups), preserving 1:1 behavior in those cases.
 */
export function getLogicalStrokeNum(
  strokeGroups: StrokeGroups | null,
  dataStrokeNum: number,
): number {
  return findDataStroke(strokeGroups, dataStrokeNum)?.logical ?? dataStrokeNum;
}

/** True when `dataStrokeNum` is the first data stroke of its logical group. */
export function isFirstInGroup(
  strokeGroups: StrokeGroups | null,
  dataStrokeNum: number,
): boolean {
  return findDataStroke(strokeGroups, dataStrokeNum)?.pos === 0;
}

/** True when `dataStrokeNum` is the last data stroke of its logical group, or unmapped. */
export function isLastInGroup(
  strokeGroups: StrokeGroups | null,
  dataStrokeNum: number,
): boolean {
  const found = findDataStroke(strokeGroups, dataStrokeNum);
  if (!found) {
    return true;
  }
  return found.pos === found.group.length - 1;
}

/** Number of remaining data strokes in `dataStrokeNum`'s group (after itself). */
export function getRemainingSkipsInGroup(
  strokeGroups: StrokeGroups | null,
  dataStrokeNum: number,
): number {
  const found = findDataStroke(strokeGroups, dataStrokeNum);
  if (!found) {
    return 0;
  }
  return found.group.length - 1 - found.pos;
}

/**
 * Convert hanzi-writer's data-stroke `strokesRemaining` into a logical-stroke
 * count consistent with `strokeGroups`. Excludes the current stroke when
 * `isCorrect` is true (matches hanzi-writer's success convention), includes
 * it when false (matches the failure convention). When `strokeGroups` is
 * incomplete and the current `dataStrokeNum` is unmapped, falls back to
 * `hwStrokesRemaining` to avoid negative results.
 */
export function logicalStrokesRemaining(
  strokeGroups: StrokeGroups | null,
  dataStrokeNum: number,
  hwStrokesRemaining: number,
  isCorrect: boolean,
): number {
  if (!strokeGroups) {
    return hwStrokesRemaining;
  }
  const found = findDataStroke(strokeGroups, dataStrokeNum);
  if (!found) {
    return hwStrokesRemaining;
  }
  return strokeGroups.length - found.logical - (isCorrect ? 1 : 0);
}
