import type { StrokeEndingType } from "../src/types.js";

interface SuggestionResult {
  type: StrokeEndingType;
  direction: [number, number] | null;
}

function normalize(v: [number, number]): [number, number] {
  const mag = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  if (mag === 0) return [0, 0];
  return [
    Math.round((v[0] / mag) * 100) / 100,
    Math.round((v[1] / mag) * 100) / 100,
  ];
}

function angle(v1: [number, number], v2: [number, number]): number {
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/**
 * Suggest stroke ending type from median data.
 *
 * Heuristic based on the last few points of the median:
 * - If there is a sharp direction change (> 60 degrees) near the end: hane
 * - If the stroke ends moving mostly downward or diagonally: harai
 * - Otherwise: tome
 */
export function suggestStrokeEnding(
  median: number[][],
): SuggestionResult {
  if (median.length < 3) {
    return { type: "tome", direction: null };
  }

  const last = median[median.length - 1] as [number, number];
  const prev = median[median.length - 2] as [number, number];
  const prevPrev = median[median.length - 3] as [number, number];

  const dirEnd: [number, number] = [last[0] - prev[0], last[1] - prev[1]];
  const dirPrev: [number, number] = [prev[0] - prevPrev[0], prev[1] - prevPrev[1]];

  const normEnd = normalize(dirEnd);
  const normPrev = normalize(dirPrev);

  const angleDiff = angle(normPrev, normEnd);

  // Sharp direction change at the end suggests hane
  if (angleDiff > Math.PI / 3) {
    return { type: "hane", direction: normEnd };
  }

  // Diagonal downward or sideways sweep suggests harai
  // In hanzi-writer coordinate system, Y decreases downward
  if (
    Math.abs(normEnd[0]) > 0.5 &&
    Math.abs(normEnd[1]) > 0.3
  ) {
    return { type: "harai", direction: normEnd };
  }

  return { type: "tome", direction: null };
}
