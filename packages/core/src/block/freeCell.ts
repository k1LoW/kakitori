import type { Char } from "../char.js";
import type { CharJudgeResult, CharJudgeStrokeResult } from "../charOptions.js";
import type { TimedPoint } from "../types.js";
import {
  normalizeCharacterSegment,
  type NormalizeTarget,
} from "../recognition/normalize.js";
import { projectClientToCell } from "../recognition/projectClientToCell.js";
import { segmentByStrokeCounts } from "../recognition/segmentation.js";
import { getJudgeChar, runWithJudgeLock, type JudgeCharEntry } from "./charCache.js";
import type {
  BlockLoaders,
  Expected,
  FreeCellResult,
} from "./types.js";

export type FreeCellLogger = (msg: string) => void;

const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULT_DRAWING_COLOR = "#222";
const DEFAULT_MATCHED_COLOR = "#0a7d2c";
const DEFAULT_FAILED_COLOR = "#c4321a";
const DEFAULT_DRAWING_WIDTH = 6;
const DEFAULT_SEGMENT_BOX_COLOR = "rgba(0, 100, 200, 0.7)";
/**
 * Free cells need looser matching than guided cells: the user has no
 * template to trace, so per-character placement / scale variation is much
 * higher even when they "wrote it correctly". Bumped from hanzi-writer's
 * stock 1.0 default to accept reasonable freehand input.
 */
const DEFAULT_FREE_CELL_LENIENCY = 1.5;

/**
 * One writable surface owned by a free cell. A single free cell may have
 * multiple surfaces — used when {@link page} splits a single annotation
 * across columns. All surfaces share the same stroke buffer / judging /
 * candidate set, but each renders its own user input independently so the
 * visual feedback stays attached to where the user actually drew.
 */
export interface FreeCellSurface {
  /** Where the surface SVG should be appended. */
  parent: HTMLElement;
  /** Surface side lengths in display pixels. */
  width: number;
  height: number;
}

export interface FreeCellCreateOptions {
  expected: Expected;
  /**
   * One or more writable surfaces. Pointer events on each surface feed
   * the same stroke buffer in time order, then the matcher normalizes
   * each character's strokes (centroid + bbox) inside the originating
   * surface's coordinate space. The cell does not enforce that a single
   * character lives on one surface; spanning surfaces is allowed but
   * mixes coordinate systems during normalization and almost always
   * misses, so treat surfaces as character-aligned partitions of the
   * answer (the page primitive places one surface per cell so the user
   * writes one character per surface naturally).
   */
  surfaces: ReadonlyArray<FreeCellSurface>;
  drawingColor?: string;
  matchedColor?: string;
  failedColor?: string;
  drawingWidth?: number;
  loaders?: BlockLoaders;
  /**
   * Stroke-matcher leniency for the per-character Chars. Higher = more
   * permissive. Defaults to {@link DEFAULT_FREE_CELL_LENIENCY} (≈ 1.5),
   * which is intentionally looser than hanzi-writer's stock 1.0 since the
   * user has no template to trace.
   */
  leniency?: number;
  /** Optional human-readable label used as a prefix in logger messages. */
  label?: string;
  /** Verbose lifecycle / matching trace. Useful for debugging convergence. */
  logger?: FreeCellLogger;
  /**
   * Debug overlay: when true, draws the per-character bbox the matcher
   * picked for the best candidate of every match attempt. Each box is
   * labelled with the character. Boxes are redrawn on every attempt and
   * cleared on `reset()`. Only honoured when there is exactly one surface
   * (boxes use surface-local coords; multi-surface overlays would need
   * extra plumbing that callers don't currently need).
   */
  showSegmentBoxes?: boolean;
  /** Color for the segment bbox overlay (debug). */
  segmentBoxColor?: string;
  onCellComplete?: (result: FreeCellResult) => void;
  /**
   * Fires after each stroke is buffered (pointerup). Lets the host
   * (block / page) record that this freeCell was the most recently
   * active target so a later undo() can be routed here.
   */
  onStroke?: () => void;
}

export interface FreeCellHandle {
  /** Underlying SVG elements (one per surface, in declaration order). */
  els: SVGSVGElement[];
  reset(): void;
  /**
   * Cell-level undo. Drops every drawn stroke and resets matching state
   * — same effect as {@link reset}, exposed under a name that matches
   * the block / page undo() entry points.
   */
  undo(): void;
  destroy(): void;
}

interface CandidateInfo {
  text: string;
  /** One per character in `text` (Array.from order). */
  chars: Array<{
    key: string;
    logicalStrokeCount: number;
    instance: Char;
    normalizeTarget: NormalizeTarget;
    /** Cache entry held so `runWithJudgeLock` can serialize judge() calls
     * across cells that share this character's cached Char. */
    entry: JudgeCharEntry;
  }>;
  totalStrokes: number;
}

interface DrawnStroke {
  points: TimedPoint[];
  el: SVGPolylineElement;
  /** Index into `surfaces` of the surface where this stroke was drawn. */
  surfaceIndex: number;
}

/** Internal: the freeCell's view of a settled candidate match. */
interface CandidateMatch {
  candidateText: string;
  similarity: number;
  perCharacter: CharJudgeResult[];
  matchedAll: boolean;
  /** Per-character bbox in cell-local pixels (used for the debug overlay). */
  segmentBoxes: Array<{ char: string; x: number; y: number; w: number; h: number }>;
}

export function createFreeCell(
  opts: FreeCellCreateOptions,
): FreeCellHandle {
  if (opts.surfaces.length === 0) {
    throw new Error("freeCell: at least one surface is required");
  }
  const drawingColor = opts.drawingColor ?? DEFAULT_DRAWING_COLOR;
  const matchedColor = opts.matchedColor ?? DEFAULT_MATCHED_COLOR;
  const failedColor = opts.failedColor ?? DEFAULT_FAILED_COLOR;
  const strokeWidth = opts.drawingWidth ?? DEFAULT_DRAWING_WIDTH;
  const segmentBoxColor = opts.segmentBoxColor ?? DEFAULT_SEGMENT_BOX_COLOR;
  const showSegmentBoxes =
    opts.showSegmentBoxes === true && opts.surfaces.length === 1;
  const leniency = opts.leniency ?? DEFAULT_FREE_CELL_LENIENCY;

  const candidatesText = normalizeExpected(opts.expected);
  const label = opts.label ?? `freeCell[${candidatesText.join("|")}]`;
  const log = opts.logger
    ? (msg: string) => opts.logger!(`${label} ${msg}`)
    : null;

  // One SVG per surface. Pointer events on each surface feed the shared
  // stroke buffer in time order, so the matcher sees a single sequence of
  // strokes regardless of which surface they originated on.
  interface Surface {
    el: SVGSVGElement;
    width: number;
    height: number;
  }
  const surfaces: Surface[] = opts.surfaces.map((s) => {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("width", String(s.width));
    svg.setAttribute("height", String(s.height));
    svg.setAttribute("viewBox", `0 0 ${s.width} ${s.height}`);
    svg.style.touchAction = "none";
    svg.style.cursor = "crosshair";
    svg.style.display = "block";
    svg.style.background = "transparent";
    s.parent.appendChild(svg);
    return { el: svg, width: s.width, height: s.height };
  });
  const els = surfaces.map((s) => s.el);

  let destroyed = false;
  let status: "drawing" | "matched" | "failed" = "drawing";
  let candidates: CandidateInfo[] | null = null;
  let candidatesLoad: Promise<CandidateInfo[]> | null = null;
  let strokes: DrawnStroke[] = [];
  let activeStroke: DrawnStroke | null = null;
  let pointerActive = false;
  /** Index of the surface that owns the in-flight stroke (-1 when idle). */
  let activeSurfaceIndex = -1;
  let lastMoveTime = 0;
  let judgeQueue: Promise<void> = Promise.resolve();
  let sessionId = 0;
  let segmentBoxEls: Array<SVGRectElement | SVGTextElement> = [];
  // Highest-similarity attempt seen across every match round in this session.
  // Used so commitFail() can surface the closest candidate / per-character
  // judge results instead of empty defaults — useful for callers wanting to
  // explain why a stroke sequence was rejected.
  let bestAttempt: CandidateMatch | null = null;

  function loadCandidates(): Promise<CandidateInfo[]> {
    if (candidates) {
      return Promise.resolve(candidates);
    }
    if (!candidatesLoad) {
      const pending = (async () => {
        log?.(`loading ${candidatesText.length} candidate(s)`);
        const out: CandidateInfo[] = [];
        for (const text of candidatesText) {
          const chars = Array.from(text);
          const charInfos = await Promise.all(
            chars.map(async (key) => {
              const entry = await getJudgeChar(key, {
                ...(opts.loaders?.charDataLoader
                  ? { charDataLoader: opts.loaders.charDataLoader }
                  : {}),
                ...(opts.loaders?.configLoader !== undefined
                  ? { configLoader: opts.loaders.configLoader }
                  : {}),
                leniency,
              });
              return {
                key,
                logicalStrokeCount: entry.logicalStrokeCount,
                instance: entry.char,
                normalizeTarget: entry.normalizeTarget,
                entry,
              };
            }),
          );
          const totalStrokes = charInfos.reduce(
            (a, b) => a + b.logicalStrokeCount,
            0,
          );
          out.push({ text, chars: charInfos, totalStrokes });
          log?.(
            `candidate "${text}" loaded: chars=[${charInfos
              .map((c) => `${c.key}=${c.logicalStrokeCount}`)
              .join(", ")}] total=${totalStrokes}`,
          );
        }
        candidates = out;
        return out;
      })();
      // On failure, drop the rejected promise so a subsequent stroke (or
      // reset() and retry) re-enters the loader instead of seeing a stale
      // permanently-rejected cache and giving up forever on what was
      // really a transient charDataLoader / configLoader error.
      candidatesLoad = pending.catch((err) => {
        if (candidatesLoad === pending) {
          candidatesLoad = null;
        }
        throw err;
      });
    }
    return candidatesLoad;
  }

  // Kick off candidate metadata load eagerly so the cell can match as soon as
  // the user finishes the right number of strokes.
  loadCandidates().catch((err) => {
    log?.(`candidate load failed: ${errorMessage(err)}`);
  });

  function projectEvent(surfaceIndex: number, e: PointerEvent): { x: number; y: number } {
    const surface = surfaces[surfaceIndex];
    const rect = surface.el.getBoundingClientRect();
    return projectClientToCell(rect, surface.width, surface.height, e.clientX, e.clientY);
  }

  function newStroke(
    surfaceIndex: number,
    p: { x: number; y: number; t: number },
  ): DrawnStroke {
    const surface = surfaces[surfaceIndex];
    const poly = document.createElementNS(SVG_NS, "polyline") as SVGPolylineElement;
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", drawingColor);
    poly.setAttribute("stroke-width", String(strokeWidth));
    poly.setAttribute("stroke-linecap", "round");
    poly.setAttribute("stroke-linejoin", "round");
    surface.el.appendChild(poly);
    appendSvgPoint(surface.el, poly, p.x, p.y);
    return { points: [p], el: poly, surfaceIndex };
  }

  function appendStrokePoint(s: DrawnStroke, p: { x: number; y: number; t: number }): void {
    s.points.push(p);
    appendSvgPoint(surfaces[s.surfaceIndex].el, s.el, p.x, p.y);
  }

  /** Append a point to a polyline via SVGPointList — O(1) per call instead
   * of the O(n) read-and-rewrite of the `points` string attribute. */
  function appendSvgPoint(
    svg: SVGSVGElement,
    poly: SVGPolylineElement,
    x: number,
    y: number,
  ): void {
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    poly.points.appendItem(pt);
  }

  function paintAll(color: string): void {
    for (const s of strokes) {
      s.el.setAttribute("stroke", color);
    }
  }

  function makePointerHandlers(surfaceIndex: number) {
    const onPointerDown = (e: PointerEvent) => {
      if (destroyed || status !== "drawing") {
        return;
      }
      pointerActive = true;
      activeSurfaceIndex = surfaceIndex;
      const t = performance.now();
      lastMoveTime = t;
      const p = projectEvent(surfaceIndex, e);
      activeStroke = newStroke(surfaceIndex, { x: p.x, y: p.y, t });
      surfaces[surfaceIndex].el.setPointerCapture(e.pointerId);
      log?.(
        `pointerdown surface=${surfaceIndex} stroke=${strokes.length} at=(${p.x.toFixed(0)},${p.y.toFixed(0)})`,
      );
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointerActive || !activeStroke || activeSurfaceIndex !== surfaceIndex) {
        return;
      }
      const t = performance.now();
      lastMoveTime = t;
      const p = projectEvent(surfaceIndex, e);
      appendStrokePoint(activeStroke, { x: p.x, y: p.y, t });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!pointerActive || !activeStroke || activeSurfaceIndex !== surfaceIndex) {
        return;
      }
      pointerActive = false;
      activeSurfaceIndex = -1;
      const releaseTime = performance.now();
      const pause = releaseTime - lastMoveTime;
      // Append a synthetic release sample (same xy as the last move, t = release).
      // judge() reads `last.t - prev.t` as the pause-before-release for tome.
      const last = activeStroke.points[activeStroke.points.length - 1];
      activeStroke.points.push({ x: last.x, y: last.y, t: releaseTime });
      const finished = activeStroke;
      activeStroke = null;
      strokes.push(finished);
      opts.onStroke?.();
      log?.(
        `pointerup surface=${surfaceIndex} stroke=${strokes.length - 1} samples=${finished.points.length} pause=${pause.toFixed(0)}ms`,
      );
      try {
        surfaces[surfaceIndex].el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore — pointer may already be released
      }
      enqueueMatch();
    };

    return { onPointerDown, onPointerMove, onPointerUp };
  }

  function enqueueMatch(): void {
    if (status !== "drawing") {
      return;
    }
    const taskSession = sessionId;
    judgeQueue = judgeQueue.then(async () => {
      if (taskSession !== sessionId || status !== "drawing") {
        return;
      }
      try {
        const list = await loadCandidates();
        if (taskSession !== sessionId || status !== "drawing") {
          return;
        }
        const total = strokes.length;
        const max = list.reduce((m, c) => Math.max(m, c.totalStrokes), 0);
        const eligible = list.filter((c) => c.totalStrokes === total);
        if (eligible.length === 0) {
          // Either still mid-input or already past every candidate's total.
          log?.(
            `match check total=${total} eligible=0 max=${max} → ${
              total > max ? "fail" : "wait"
            }`,
          );
          if (total > max) {
            commitFail();
          }
          return;
        }
        log?.(
          `match check total=${total} eligible=${eligible
            .map((c) => `"${c.text}"`)
            .join(",")}`,
        );
        const attempts: CandidateMatch[] = [];
        for (const candidate of eligible) {
          if (taskSession !== sessionId || status !== "drawing" || destroyed) {
            return;
          }
          const match = await tryCandidate(candidate);
          // tryCandidate awaits per-stroke judge() calls; reset()/destroy()
          // (which bump sessionId / set destroyed) may have raced in during
          // any of those awaits, so the result we just collected belongs to
          // a stale session and must be discarded before we touch shared
          // state (bestAttempt) or DOM (drawSegmentBoxes / commitMatch).
          if (taskSession !== sessionId || status !== "drawing" || destroyed) {
            return;
          }
          log?.(
            `try "${candidate.text}" → matched=${match.matchedAll} sim=${match.similarity.toFixed(
              2,
            )}`,
          );
          attempts.push(match);
        }
        // Pick the best matched candidate; if none matched, the highest
        // similarity attempt becomes the failure record (used when the user
        // exhausts every candidate).
        attempts.sort((a, b) => Number(b.matchedAll) - Number(a.matchedAll) || b.similarity - a.similarity);
        const best = attempts[0];
        if (!bestAttempt || best.similarity > bestAttempt.similarity) {
          bestAttempt = best;
        }
        // Show the bbox the matcher chose for this round so debug overlays
        // reveal what segmentation the matcher saw.
        drawSegmentBoxes(best.segmentBoxes);
        if (best.matchedAll) {
          commitMatch(best);
        } else if (total >= max) {
          // No longer candidate is reachable (every candidate is at most
          // `max` strokes long), so an extra stroke can't rescue the cell.
          // Commit the failure now instead of waiting for total > max,
          // which would force the user to draw an extra stroke just to
          // see the rejection.
          commitFail();
        }
      } catch (err) {
        log?.(`match error: ${errorMessage(err)}`);
        // matching error: leave status='drawing' so further strokes can try
      }
    });
    void judgeQueue;
  }

  async function tryCandidate(candidate: CandidateInfo): Promise<CandidateMatch> {
    const counts = candidate.chars.map((c) => c.logicalStrokeCount);
    const segments = segmentByStrokeCounts(strokes.map((s) => s.points), counts);
    const perCharacter: CharJudgeResult[] = [];
    const segmentBoxes: CandidateMatch["segmentBoxes"] = [];
    let matchedAll = true;
    let similaritySum = 0;
    let similarityCount = 0;
    for (let i = 0; i < candidate.chars.length; i++) {
      const charInfo = candidate.chars[i];
      const charSegments = segments[i];
      const bbox = bboxOfSegments(charSegments);
      if (bbox) {
        segmentBoxes.push({ char: charInfo.key, ...bbox });
      }
      const normalized = normalizeCharacterSegment(
        charSegments,
        charInfo.normalizeTarget,
      );
      // Each character's strokes drive judge() in logical order. The Char
      // instance is shared across cells via charCache; `runWithJudgeLock`
      // serializes the entire per-character sequence so the shared
      // hanzi-writer quiz state (`_currentStrokeIndex`, `_userStroke`,
      // `capture`) and the awaits inside ending judgment can't interleave
      // with another cell judging the same character. Per-stroke results
      // are still collected from the awaited returns instead of reading
      // `instance.result()` later, in case a different candidate locks the
      // entry between this and the post-loop bookkeeping.
      const perStroke: CharJudgeStrokeResult[] = [];
      let charMatched = normalized.length > 0;
      let charSimSum = 0;
      await runWithJudgeLock(charInfo.entry, async () => {
        for (let j = 0; j < normalized.length; j++) {
          const stroke = await charInfo.instance.judge(j, normalized[j]);
          perStroke.push(stroke);
          if (!stroke.matched) {
            charMatched = false;
          }
          similaritySum += stroke.similarity;
          similarityCount++;
          charSimSum += stroke.similarity;
        }
      });
      const result: CharJudgeResult = { matched: charMatched, perStroke };
      perCharacter.push(result);
      const charAvgSim = perStroke.length > 0 ? charSimSum / perStroke.length : 0;
      const perStrokeFlags = perStroke
        .map((s) => `${s.matched ? "✓" : "✗"}${s.similarity.toFixed(2)}`)
        .join(",");
      log?.(
        `  "${candidate.text}"[${i}] "${charInfo.key}" matched=${result.matched} avgSim=${charAvgSim.toFixed(
          2,
        )} strokes=[${perStrokeFlags}]`,
      );
      if (!result.matched) {
        matchedAll = false;
      }
    }
    const similarity = similarityCount > 0 ? similaritySum / similarityCount : 0;
    return {
      candidateText: candidate.text,
      similarity,
      perCharacter,
      matchedAll,
      segmentBoxes,
    };
  }

  function clearSegmentBoxes(): void {
    for (const node of segmentBoxEls) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
    segmentBoxEls = [];
  }

  function drawSegmentBoxes(boxes: CandidateMatch["segmentBoxes"]): void {
    clearSegmentBoxes();
    if (!showSegmentBoxes) {
      return;
    }
    // Only enabled when there's exactly one surface (see option docs); the
    // debug overlay is rendered into that single SVG.
    const svg = surfaces[0].el;
    for (const b of boxes) {
      const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
      rect.setAttribute("x", String(b.x));
      rect.setAttribute("y", String(b.y));
      rect.setAttribute("width", String(b.w));
      rect.setAttribute("height", String(b.h));
      rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", segmentBoxColor);
      rect.setAttribute("stroke-width", "2");
      rect.setAttribute("stroke-dasharray", "5,4");
      rect.setAttribute("pointer-events", "none");
      svg.appendChild(rect);
      segmentBoxEls.push(rect);
      const labelEl = document.createElementNS(SVG_NS, "text") as SVGTextElement;
      labelEl.setAttribute("x", String(b.x + 4));
      labelEl.setAttribute("y", String(b.y + 16));
      labelEl.setAttribute("font-size", "13");
      labelEl.setAttribute("font-family", "sans-serif");
      labelEl.setAttribute("fill", segmentBoxColor);
      labelEl.setAttribute("pointer-events", "none");
      labelEl.textContent = b.char;
      svg.appendChild(labelEl);
      segmentBoxEls.push(labelEl);
    }
  }

  function bboxOfSegments(
    segs: ReadonlyArray<ReadonlyArray<TimedPoint>>,
  ): { x: number; y: number; w: number; h: number } | null {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let any = false;
    for (const stroke of segs) {
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
        any = true;
      }
    }
    if (!any) {
      return null;
    }
    // Show the canonical 1-character square: side = longer of width/height,
    // centered on the user's bbox center. This matches the matcher's view
    // (longer side scales to the median's longer side; the shorter axis
    // sits within that same square), so the overlay reads as "this is the
    // judgement cell" rather than "this is exactly what was drawn".
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const side = Math.max(maxX - minX, maxY - minY);
    const pad = 4;
    return {
      x: cx - side / 2 - pad,
      y: cy - side / 2 - pad,
      w: side + pad * 2,
      h: side + pad * 2,
    };
  }

  function commitMatch(m: CandidateMatch): void {
    if (status !== "drawing") {
      return;
    }
    status = "matched";
    paintAll(matchedColor);
    log?.(`commit match "${m.candidateText}" sim=${m.similarity.toFixed(2)}`);
    opts.onCellComplete?.({
      kind: "free",
      matched: true,
      candidate: m.candidateText,
      similarity: m.similarity,
      perCharacter: m.perCharacter,
    });
  }

  function commitFail(): void {
    if (status !== "drawing") {
      return;
    }
    status = "failed";
    paintAll(failedColor);
    if (bestAttempt) {
      log?.(
        `commit fail (best attempt "${bestAttempt.candidateText}" sim=${bestAttempt.similarity.toFixed(2)})`,
      );
      opts.onCellComplete?.({
        kind: "free",
        matched: false,
        candidate: bestAttempt.candidateText,
        similarity: bestAttempt.similarity,
        perCharacter: bestAttempt.perCharacter,
      });
    } else {
      log?.(`commit fail (no candidate matched)`);
      opts.onCellComplete?.({
        kind: "free",
        matched: false,
        candidate: null,
        similarity: 0,
        perCharacter: [],
      });
    }
  }

  // Per-surface listeners. Each surface gets its own pointer handlers
  // closed over the surface index so we know where pointer events came
  // from (and where to attach the polylines visual feedback uses).
  const surfaceHandlers = surfaces.map((_, i) => makePointerHandlers(i));
  surfaces.forEach((s, i) => {
    const h = surfaceHandlers[i];
    s.el.addEventListener("pointerdown", h.onPointerDown, true);
    s.el.addEventListener("pointermove", h.onPointerMove, true);
    s.el.addEventListener("pointerup", h.onPointerUp, true);
    s.el.addEventListener("pointercancel", h.onPointerUp, true);
  });

  function clearAll(): void {
    sessionId++;
    status = "drawing";
    pointerActive = false;
    activeStroke = null;
    activeSurfaceIndex = -1;
    strokes = [];
    segmentBoxEls = [];
    bestAttempt = null;
    // Drop any pending judge tail so a stale match does not flip the new
    // session into matched/failed.
    judgeQueue = Promise.resolve();
    for (const s of surfaces) {
      while (s.el.firstChild) {
        s.el.removeChild(s.el.firstChild);
      }
    }
  }

  return {
    els,
    reset: clearAll,
    undo: clearAll,
    destroy(): void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      sessionId++;
      surfaces.forEach((s, i) => {
        const h = surfaceHandlers[i];
        s.el.removeEventListener("pointerdown", h.onPointerDown, true);
        s.el.removeEventListener("pointermove", h.onPointerMove, true);
        s.el.removeEventListener("pointerup", h.onPointerUp, true);
        s.el.removeEventListener("pointercancel", h.onPointerUp, true);
        if (s.el.parentNode) {
          s.el.parentNode.removeChild(s.el);
        }
      });
    },
  };
}

function normalizeExpected(expected: Expected): string[] {
  if (Array.isArray(expected)) {
    if (expected.length === 0) {
      throw new Error("freeCell: expected must be a non-empty string array");
    }
    expected.forEach((s, i) => {
      if (typeof s !== "string" || s.length === 0) {
        throw new Error(
          `freeCell: expected[${i}] must be a non-empty string (got ${JSON.stringify(s)})`,
        );
      }
    });
    return [...expected];
  }
  if (expected.length === 0) {
    throw new Error("freeCell: expected must be a non-empty string");
  }
  return [expected];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
