import type { TimedPoint } from "../types.js";
import { HANZI_COORD_SIZE } from "../constants.js";

/**
 * Bounding-box description of where the normalized character should land in
 * hanzi-writer's internal coordinate system. Centered at `(centerX, centerY)`
 * (Y-up); the user's longer-side spans `longerSide` after scaling.
 */
export interface NormalizeTarget {
  centerX: number;
  centerY: number;
  longerSide: number;
}

/**
 * Default target: the full HANZI_COORD_SIZE square. Use this only when the
 * caller has no per-character median data (the `getAverageDistance` matcher
 * is calibrated against character medians that sit inside HANZI_COORD_SIZE
 * with their own padding, so a per-character target tuned to that median is
 * always more accurate).
 */
export const DEFAULT_NORMALIZE_TARGET: NormalizeTarget = {
  centerX: HANZI_COORD_SIZE / 2,
  centerY: HANZI_COORD_SIZE / 2,
  longerSide: HANZI_COORD_SIZE,
};

/**
 * Normalize a single character's drawn strokes so they overlap the matcher's
 * expected character region. The user's bbox is centered on `target.center`
 * and scaled so its longer side equals `target.longerSide`; aspect ratio is
 * preserved. The y axis is flipped so source-Y-down (browser / SVG) becomes
 * target-Y-up (hanzi-writer internal).
 *
 * For accurate matching, callers should pass a target derived from the
 * character's median bounding box (see `block/charCache.ts`). When the
 * target is omitted, {@link DEFAULT_NORMALIZE_TARGET} maps the user's
 * longer side to the full canvas, which can over-shoot the natural extent
 * of any one character's median and inflate the matcher's average distance.
 *
 * Timestamps (`t`) pass through unchanged so that ending judgment (which
 * relies on the release sample's `t - prev.t` gap) keeps working after
 * normalization.
 */
export function normalizeCharacterSegment(
  strokes: ReadonlyArray<ReadonlyArray<TimedPoint>>,
  target: NormalizeTarget = DEFAULT_NORMALIZE_TARGET,
): TimedPoint[][] {
  if (strokes.length === 0) {
    return [];
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const stroke of strokes) {
    for (const p of stroke) {
      if (p.x < minX) {
        minX = p.x;
      }
      if (p.x > maxX) {
        maxX = p.x;
      }
      if (p.y < minY) {
        minY = p.y;
      }
      if (p.y > maxY) {
        maxY = p.y;
      }
      sumX += p.x;
      sumY += p.y;
      count++;
    }
  }

  if (count === 0) {
    return strokes.map(() => []);
  }

  const centroidX = sumX / count;
  const centroidY = sumY / count;
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;
  const longer = Math.max(bboxW, bboxH);

  // A single-point segment (or strokes that all coincide) collapses to the
  // target center to avoid division by zero. The matcher will reject such
  // a degenerate input as a miss anyway, so the exact placement doesn't
  // matter, but `Number.isFinite` callers downstream still want safe values.
  if (longer === 0) {
    return strokes.map((stroke) =>
      stroke.map((p) => ({ x: target.centerX, y: target.centerY, t: p.t })),
    );
  }

  const scale = target.longerSide / longer;
  return strokes.map((stroke) =>
    stroke.map((p) => ({
      x: target.centerX + (p.x - centroidX) * scale,
      // Flip Y so that source-Y-down (browser / SVG) becomes target-Y-up
      // (hanzi-writer internal). Together with the centroid translation,
      // a stroke drawn at the top of the input box ends up with high y
      // in the output.
      y: target.centerY - (p.y - centroidY) * scale,
      t: p.t,
    })),
  );
}
