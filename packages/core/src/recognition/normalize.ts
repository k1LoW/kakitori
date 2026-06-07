import type { TimedPoint } from "../types.js";
import {
  HANZI_PRESCALED_SIZE,
  HANZI_Y_MAX,
  HANZI_Y_MIN,
} from "../constants.js";

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
 * Default target: the full HANZI_PRESCALED_SIZE square. Use this only when
 * the caller has no per-character median data (the `getAverageDistance`
 * matcher is calibrated against character medians that sit inside the
 * HANZI_PRESCALED_SIZE canvas with their own padding, so a per-character
 * target tuned to that median is always more accurate).
 */
export const DEFAULT_NORMALIZE_TARGET: NormalizeTarget = {
  centerX: HANZI_PRESCALED_SIZE / 2,
  // hanzi-writer's Y range is [-124, 900] (asymmetric — characters can
  // descend below the baseline), so the canvas center along Y is 388,
  // not 512. Centering at HANZI_PRESCALED_SIZE / 2 here would shift the
  // normalized cloud 124 units up relative to the matcher's medians.
  centerY: (HANZI_Y_MIN + HANZI_Y_MAX) / 2,
  longerSide: HANZI_PRESCALED_SIZE,
};

/**
 * Normalize a single character's drawn strokes so they overlap the matcher's
 * expected character region. The user's **bounding-box centre** is moved
 * onto `target.center`, and the points are uniformly scaled so the bounding
 * box's longer side equals `target.longerSide`; aspect ratio is preserved.
 * The y axis is flipped so source-Y-down (browser / SVG) becomes target-Y-up
 * (hanzi-writer internal).
 *
 * Using the bbox centre (rather than the sample centroid) keeps the
 * normalized output strictly inside the target's `centerX ± longerSide/2`
 * / `centerY ± longerSide/2` square, which in turn keeps it inside the
 * standard hanzi region (`[0, HANZI_PRESCALED_SIZE]` / `[HANZI_Y_MIN,
 * HANZI_Y_MAX]`) for any target derived from a median bbox. That means a
 * `CharResult.perStroke[].points` produced from a free cell renders
 * identically to one produced from a guided cell — and downstream
 * consumers (`block.restore`, `page.restore`) can lay out the chars
 * inside their `cellSize`-sized slots without worrying about samples
 * landing outside the rendered area. A centroid-based reference would
 * push descender-heavy chars (e.g. "ま" with its bottom curl carrying
 * many samples) past the standard bounds and clip them at restore time.
 *
 * Outlier robustness is delegated to segmentation: the matcher runs
 * `segmentByStrokeCounts` first, so if the user's input contained a
 * stroke-count mismatch (the only realistic source of "true outliers"
 * at this layer) the whole attempt is rejected upstream of normalize.
 * Anything that does reach normalize is a clean per-character segment.
 *
 * For accurate matching, callers should pass a target derived from the
 * character's median bounding box (see `block/charCache.ts`). When the
 * target is omitted, {@link DEFAULT_NORMALIZE_TARGET} maps the user's
 * longer side to the full canvas, which can over-shoot the natural extent
 * of any one character's median and inflate the matcher's average distance.
 *
 * Timestamps (`t`) pass through unchanged so that ending check (which
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
      count++;
    }
  }

  if (count === 0) {
    return strokes.map(() => []);
  }

  const bboxCenterX = (minX + maxX) / 2;
  const bboxCenterY = (minY + maxY) / 2;
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
      x: target.centerX + (p.x - bboxCenterX) * scale,
      // Flip Y so that source-Y-down (browser / SVG) becomes target-Y-up
      // (hanzi-writer internal). Together with the bbox-centre
      // translation, a stroke drawn at the top of the input box ends up
      // with high y in the output.
      y: target.centerY - (p.y - bboxCenterY) * scale,
      t: p.t,
    })),
  );
}
