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
 * Median data carries no timing, so the speed condition for hane (tip faster
 * than body) cannot be evaluated here. We approximate hane purely from the
 * geometric direction change, using the same body (40-70%) vs tip (85-end)
 * windows as the runtime judge so suggestions and judgments stay aligned:
 * - Direction change >= 90 degrees between body and tip: hane
 * - End sweeps diagonally/sideways: harai
 * - Otherwise: tome
 */
export function suggestStrokeEnding(
  median: number[][],
): SuggestionResult {
  const n = median.length;
  if (n < 3) {
    return { type: "tome", direction: null };
  }

  const last = median[n - 1] as [number, number];
  const prev = median[n - 2] as [number, number];
  const dirEnd: [number, number] = [last[0] - prev[0], last[1] - prev[1]];
  const normEnd = normalize(dirEnd);

  if (n >= 6) {
    const bodyStart = Math.floor(n * 0.4);
    const bodyEnd = Math.floor(n * 0.7);
    const tipStart = Math.floor(n * 0.85);

    const bodyStartPt = median[bodyStart] as [number, number];
    const bodyEndPt = median[bodyEnd] as [number, number];
    const tipStartPt = median[tipStart] as [number, number];

    const bodyDir = normalize([
      bodyEndPt[0] - bodyStartPt[0],
      bodyEndPt[1] - bodyStartPt[1],
    ]);
    const tipDir = normalize([
      last[0] - tipStartPt[0],
      last[1] - tipStartPt[1],
    ]);

    if (angle(bodyDir, tipDir) >= Math.PI / 2) {
      return { type: "hane", direction: tipDir };
    }
  }

  // Diagonal downward or sideways sweep suggests harai.
  // In hanzi-writer coordinate system, Y decreases downward.
  if (Math.abs(normEnd[0]) > 0.5 && Math.abs(normEnd[1]) > 0.3) {
    return { type: "harai", direction: normEnd };
  }

  return { type: "tome", direction: null };
}
