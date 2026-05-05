import HanziWriter from "hanzi-writer";
import type { CharOptions, CharLogger, RenderOptions, GridOptions } from "./charOptions.js";
import type {
  StrokeEnding,
  StrokeEndingJudgment,
  CharStrokeData,
} from "./types.js";
import type { StrokeTimingData } from "./StrokeEndingJudge.js";
import { defaultCharDataLoader, defaultConfigLoader } from "./dataLoader.js";
import { DEFAULT_SIZE, DEFAULT_PADDING, HANZI_COORD_SIZE } from "./constants.js";
import { computeEndingJudgment } from "./endingJudgment.js";
import { attachEndingJudgmentPatch } from "./patchEndingJudgment.js";
import {
  isFirstInGroup as isFirstInGroupPure,
  isLastInGroup as isLastInGroupPure,
  getLogicalStrokeNum as getLogicalStrokeNumPure,
  getRemainingSkipsInGroup as getRemainingSkipsInGroupPure,
  logicalStrokesRemaining as logicalStrokesRemainingPure,
} from "./strokeGroups.js";

const DEFAULT_GRID_COLOR = "#ccc";
const DEFAULT_GRID_DASH = "10,10";
const DEFAULT_GRID_WIDTH = 2;

function drawCrossGrid(
  svg: SVGSVGElement,
  size: number,
  gridOpts: GridOptions | true,
): void {
  const opts = gridOpts === true ? {} : gridOpts;
  const color = opts.color ?? DEFAULT_GRID_COLOR;
  const dashArray = opts.dashArray ?? DEFAULT_GRID_DASH;
  const width = opts.width ?? DEFAULT_GRID_WIDTH;
  const ns = "http://www.w3.org/2000/svg";
  const mid = size / 2;

  const vLine = document.createElementNS(ns, "line");
  vLine.setAttribute("x1", String(mid));
  vLine.setAttribute("y1", "0");
  vLine.setAttribute("x2", String(mid));
  vLine.setAttribute("y2", String(size));
  vLine.setAttribute("stroke", color);
  vLine.setAttribute("stroke-width", String(width));
  vLine.setAttribute("stroke-dasharray", dashArray);
  vLine.setAttribute("pointer-events", "none");

  const hLine = document.createElementNS(ns, "line");
  hLine.setAttribute("x1", "0");
  hLine.setAttribute("y1", String(mid));
  hLine.setAttribute("x2", String(size));
  hLine.setAttribute("y2", String(mid));
  hLine.setAttribute("stroke", color);
  hLine.setAttribute("stroke-width", String(width));
  hLine.setAttribute("stroke-dasharray", dashArray);
  hLine.setAttribute("pointer-events", "none");

  svg.appendChild(vLine);
  svg.appendChild(hLine);
}

function validateSizeAndPadding(
  size: number,
  padding: number,
  context: string,
): void {
  if (!Number.isFinite(size)) {
    throw new Error(`${context}: size must be finite, got ${size}`);
  }
  if (size <= 0) {
    throw new Error(`${context}: size must be positive, got ${size}`);
  }
  if (!Number.isFinite(padding)) {
    throw new Error(`${context}: padding must be finite, got ${padding}`);
  }
  if (padding < 0) {
    throw new Error(`${context}: padding must be non-negative, got ${padding}`);
  }
  if (padding >= size / 2) {
    throw new Error(`${context}: padding (${padding}) must be less than size/2 (${size / 2})`);
  }
}

export function computeMedianPathLength(
  points: Array<{ x: number; y: number }>,
): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

/**
 * A Char instance: 1-character writing-practice surface backed by HanziWriter.
 * Returned by {@link char.create}.
 */
export interface Char {
  /** Wait for the async config (strokeGroups, strokeEndings) to finish loading. */
  ready(): Promise<void>;
  /** Start writing practice with stroke order and stroke ending (tome/hane/harai) judgment. */
  start(): void;
  /**
   * Play stroke-order animation. Always uses the animCJK-style overlay so
   * each stroke's duration is proportional to its median length; defaults to
   * one-stroke-per-group when strokeGroups is not configured.
   */
  animate(): void;
  /** Hide the character strokes. */
  hideCharacter(): void;
  /** Show the character strokes. */
  showCharacter(): void;
  /** Show the character outline (light gray background). */
  showOutline(): void;
  /** Hide the character outline. */
  hideOutline(): void;
  /** Return the stroke endings loaded from config, or null if not loaded. */
  getStrokeEndings(): readonly StrokeEnding[] | null;
  /** Return the stroke groups loaded from config, or null if not loaded. */
  getStrokeGroups(): readonly number[][] | null;
  /** Override stroke groups. Rebuilds internal group maps. */
  setStrokeGroups(strokeGroups: number[][]): void;
  /** Override stroke endings. */
  setStrokeEndings(strokeEndings: StrokeEnding[]): void;
  /**
   * Get the logical stroke index at a given point (client coordinates).
   * Uses document.elementFromPoint for accurate hit detection that respects
   * clip-paths and actual rendered output. Returns null if no stroke found.
   */
  getStrokeIndexAtPoint(clientX: number, clientY: number): number | null;
  /** Set the color of a logical stroke. */
  setStrokeColor(logicalStrokeNum: number, color?: string): void;
  /** Reset a single logical stroke's color to its original value. */
  resetStrokeColor(logicalStrokeNum: number): void;
  /** Reset all stroke colors to their original values. */
  resetStrokeColors(): void;
  /** Get the total number of logical strokes. */
  getLogicalStrokeCount(): number;
  /** Change the displayed character. Resets stroke endings and mistake count. */
  setCharacter(c: string): Promise<void>;
  /**
   * Clean up event listeners, remove the rendered SVG, and mark the instance as destroyed.
   * After destroy, calling any other public method throws. destroy() itself is idempotent.
   */
  destroy(): void;
}

function createImpl(
  target: string | HTMLElement,
  character: string,
  options: CharOptions = {},
): Char {
  // === state (closure) ===
  let destroyed = false;
  let strokeEndings: StrokeEnding[] | null = null;
  let strokeGroups: number[][] | null = options.strokeGroups ?? null;
  let characterData: any = null;
  let strokeEndingMistakes = 0;
  const log: CharLogger | null = options.logger ?? null;

  // Wrapper element inserted into targetEl; owns the positioning context for
  // hanzi-writer's SVG, the optional grid SVG, and the animate() overlay.
  // Appended below and dropped via destroy() (which clears targetEl.innerHTML),
  // so the host element's styles are never mutated even though its child list is.
  let layerEl!: HTMLElement;
  // hanzi-writer's main SVG, captured right after HanziWriter.create().
  let hwSvg: SVGSVGElement | null = null;
  // Optional grid SVG layered behind hanzi-writer's SVG so it stays visible
  // while hanzi-writer is hidden during animate(). Null when showGrid is off.
  let gridSvg: SVGSVGElement | null = null;
  // Reference to the overlay SVG currently displayed by an animateWithGroups()
  // run, or null when no animation is in flight. A run's cleanup only fires if
  // its overlay is still the active one, which lets a newer run supersede an
  // older one without coordinating on a separate identifier.
  let activeOverlay: SVGSVGElement | null = null;

  // Bridge: judgment computed in patched _handleSuccess, consumed in onCorrectStroke
  let pendingEndingJudgment: StrokeEndingJudgment | null = null;

  // onClick listener
  let boundOnClick: ((e: MouseEvent) => void) | null = null;

  // Pointer timing tracking
  let isPointerDown = false;
  let lastMoveTime = 0;
  let releaseTime = 0;
  let timedPoints: Array<{ x: number; y: number; t: number }> = [];
  let boundOnPointerDown: ((e: PointerEvent) => void) | null = null;
  let boundOnPointerMove: ((e: PointerEvent) => void) | null = null;
  let boundOnPointerUp: ((e: PointerEvent) => void) | null = null;

  // === helpers ===
  function assertNotDestroyed(): void {
    if (destroyed) {
      throw new Error("char: instance has been destroyed and cannot be used.");
    }
  }

  function isFirstInGroup(dataStrokeNum: number): boolean {
    return isFirstInGroupPure(strokeGroups, dataStrokeNum);
  }

  function isLastInGroup(dataStrokeNum: number): boolean {
    return isLastInGroupPure(strokeGroups, dataStrokeNum);
  }

  function getLogicalStrokeNum(dataStrokeNum: number): number {
    return getLogicalStrokeNumPure(strokeGroups, dataStrokeNum);
  }

  function getRemainingSkipsInGroup(dataStrokeNum: number): number {
    return getRemainingSkipsInGroupPure(strokeGroups, dataStrokeNum);
  }

  function logicalStrokesRemaining(
    dataStrokeNum: number,
    hwStrokesRemaining: number,
    isCorrect: boolean,
  ): number {
    return logicalStrokesRemainingPure(strokeGroups, dataStrokeNum, hwStrokesRemaining, isCorrect);
  }

  function startTimingTracking(): void {
    stopTimingTracking();

    boundOnPointerDown = (e: PointerEvent) => {
      isPointerDown = true;
      timedPoints = [];
      lastMoveTime = performance.now();
      releaseTime = 0;
      log?.(`pointerdown  x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}`);
    };
    boundOnPointerMove = (e: PointerEvent) => {
      if (!isPointerDown) {
        return;
      }
      const now = performance.now();
      const dt = (now - lastMoveTime).toFixed(0);
      lastMoveTime = now;
      timedPoints.push({ x: e.clientX, y: e.clientY, t: now });
      log?.(`pointermove  x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}  dt=${dt}ms`);
    };
    boundOnPointerUp = (e: PointerEvent) => {
      if (!isPointerDown) {
        return;
      }
      isPointerDown = false;
      releaseTime = performance.now();
      const pause = (releaseTime - lastMoveTime).toFixed(0);
      log?.(`pointerup    x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}  pause=${pause}ms`);
    };

    targetEl.addEventListener("pointerdown", boundOnPointerDown);
    targetEl.addEventListener("pointermove", boundOnPointerMove);
    targetEl.addEventListener("pointerup", boundOnPointerUp);
  }

  function stopTimingTracking(): void {
    if (boundOnPointerDown) {
      targetEl.removeEventListener("pointerdown", boundOnPointerDown);
      boundOnPointerDown = null;
    }
    if (boundOnPointerMove) {
      targetEl.removeEventListener("pointermove", boundOnPointerMove);
      boundOnPointerMove = null;
    }
    if (boundOnPointerUp) {
      targetEl.removeEventListener("pointerup", boundOnPointerUp);
      boundOnPointerUp = null;
    }
  }

  function getTimingData(): StrokeTimingData {
    const pauseBeforeRelease =
      releaseTime > 0 && lastMoveTime > 0
        ? releaseTime - lastMoveTime
        : 0;
    return {
      pauseBeforeRelease,
      timedPoints: [...timedPoints],
    };
  }

  /**
   * Adapter around the pure {@link computeEndingJudgment}: pulls the drawn
   * points and timing out of the active hanzi-writer quiz and forwards the
   * remaining inputs (config, character data, options) from the closure.
   */
  function runEndingJudgment(
    quiz: any,
    dataStrokeNum: number,
    meta: any,
  ): StrokeEndingJudgment | null {
    const hwData = quiz._getStrokeData({ isCorrect: true, meta });
    return computeEndingJudgment({
      dataStrokeNum,
      drawnPoints: hwData.drawnPath.points,
      timing: getTimingData(),
      strokeEndings,
      strokeGroups,
      characterData,
      drawableSize: (options.size ?? DEFAULT_SIZE) - 2 * (options.padding ?? DEFAULT_PADDING),
      strictness: options.strokeEndingStrictness ?? 0.7,
      log,
    });
  }

  /**
   * Wrap the active hanzi-writer Quiz so stroke ending judgment runs before
   * the success-and-advance step. Delegates the wiring to
   * {@link attachEndingJudgmentPatch}; this closure-side function is the
   * adapter that pulls dependencies out of the closure.
   */
  function patchQuizForEnding(): void {
    const quiz: any = (hw as any)._quiz;
    if (!quiz) {
      return;
    }
    attachEndingJudgmentPatch(quiz, {
      runJudgment: runEndingJudgment,
      onMistake: (judgment, { quiz: q, dataStrokeNum, willAdvance, meta }) => {
        strokeEndingMistakes++;
        // Report `strokesRemaining` in logical-stroke units consistent with
        // `onCorrectStroke` / `onMistake`. When the stroke will be accepted
        // (`strokeEndingAsMiss=false`), exclude the current stroke; when
        // rejected (`strokeEndingAsMiss=true`), include it.
        const hwData = q._getStrokeData({ isCorrect: willAdvance, meta });
        const logicalStrokeNum = getLogicalStrokeNum(dataStrokeNum);
        const charData: CharStrokeData = {
          character: currentCharacter,
          strokeNum: logicalStrokeNum,
          drawnPath: hwData.drawnPath,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: logicalStrokesRemaining(dataStrokeNum, hwData.strokesRemaining, willAdvance),
          strokeEnding: judgment,
        };
        options.onStrokeEndingMistake?.(charData);
      },
      onResolved: (j) => {
        pendingEndingJudgment = j;
      },
      strokeEndingAsMiss: !!options.strokeEndingAsMiss,
      log,
    });
  }

  function startQuiz(): void {
    strokeEndingMistakes = 0;
    pendingEndingJudgment = null;

    // Pre-load character data for direction auto-computation
    hw.getCharacterData().then((c) => {
      if (destroyed) {
        return;
      }
      characterData = c;
    });

    startTimingTracking();

    const quizPromise = hw.quiz({
      leniency: options.leniency,
      showHintAfterMisses: options.showHintAfterMisses,
      highlightOnComplete: options.highlightOnComplete,

      onCorrectStroke: (hwData) => {
        const dataStrokeNum = hwData.strokeNum;
        const logicalStrokeNum = getLogicalStrokeNum(dataStrokeNum);
        const isLast = isLastInGroup(dataStrokeNum);
        const skipsNeeded = getRemainingSkipsInGroup(dataStrokeNum);

        log?.(`stroke correct: data=${dataStrokeNum} logical=${logicalStrokeNum} isLast=${isLast} skips=${skipsNeeded}`);

        // Skip remaining strokes in the group
        if (skipsNeeded > 0) {
          log?.(`auto-skipping ${skipsNeeded} stroke(s) in group`);
          for (let i = 0; i < skipsNeeded; i++) {
            hw.skipQuizStroke();
          }
        }

        const charData: CharStrokeData = {
          character: currentCharacter,
          strokeNum: logicalStrokeNum,
          drawnPath: hwData.drawnPath,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: logicalStrokesRemaining(dataStrokeNum, hwData.strokesRemaining, true),
        };

        if (pendingEndingJudgment != null) {
          charData.strokeEnding = pendingEndingJudgment;
          pendingEndingJudgment = null;
        }

        // Only fire callback on the first stroke of a group (the one the user actually drew)
        if (isFirstInGroup(dataStrokeNum) || !strokeGroups) {
          options.onCorrectStroke?.(charData);
        }
      },

      onMistake: (hwData) => {
        const logicalStrokeNum = getLogicalStrokeNum(hwData.strokeNum);
        const charData: CharStrokeData = {
          character: currentCharacter,
          strokeNum: logicalStrokeNum,
          drawnPath: hwData.drawnPath,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: logicalStrokesRemaining(hwData.strokeNum, hwData.strokesRemaining, false),
        };
        log?.(`mistake: data=${hwData.strokeNum} logical=${logicalStrokeNum}`);
        options.onMistake?.(charData);
      },

      onComplete: (summary) => {
        stopTimingTracking();
        log?.(`complete: totalMistakes=${summary.totalMistakes} strokeEndingMistakes=${strokeEndingMistakes}`);
        options.onComplete?.({
          character: summary.character,
          totalMistakes: summary.totalMistakes,
          strokeEndingMistakes,
        });
      },
    });

    // hanzi-writer creates `_quiz` asynchronously inside `quiz()` (after
    // character data resolves). Patch its `_handleSuccess` once available so
    // we can intercept the success-then-advance flow with stroke ending
    // judgment and optionally redirect to the failure path.
    Promise.resolve(quizPromise).then(() => {
      if (destroyed) {
        return;
      }
      patchQuizForEnding();
    });
  }

  /**
   * Animate using an animCJK-style SVG overlay.
   * Creates a temporary SVG on top of HanziWriter's SVG,
   * hides HanziWriter's character, plays CSS stroke-dash animation,
   * then shows HanziWriter's character and removes the overlay.
   */
  async function animateWithGroups(): Promise<void> {
    const rawSpeed = options.strokeAnimationSpeed ?? 1;
    const speed = Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 1;
    if (speed !== rawSpeed) {
      log?.(`strokeAnimationSpeed must be a positive finite number, got ${rawSpeed}; falling back to 1`);
    }
    const delayBetweenStrokes = options.delayBetweenStrokes ?? 1000;
    const strokeColor = options.strokeColor ?? "#555";
    const outlineColor = options.outlineColor ?? "#DDD";

    const charData = await hw.getCharacterData();
    const dataStrokes = charData.strokes;

    // Default to identity grouping (one logical stroke per data stroke) so the
    // length-proportional duration applies even when no kakitori-data config
    // has set explicit strokeGroups. Named distinctly from the closure
    // `strokeGroups` so later edits cannot accidentally read the stale value.
    const resolvedStrokeGroups = strokeGroups
      ?? Array.from({ length: dataStrokes.length }, (_, i) => [i]);

    const localHwSvg = hwSvg;
    if (!localHwSvg) {
      return;
    }
    const width = localHwSvg.getAttribute("width") || "300";
    const height = localHwSvg.getAttribute("height") || "300";

    // animCJK-style constants
    const PATH_LENGTH = 3333;
    const DASH_ARRAY = 3337;
    const DASH_OFFSET = 3339;
    // Base duration: time to draw a stroke that spans the full HANZI_COORD_SIZE.
    const BASE_STROKE_DURATION = 0.8 / speed;

    // Compute median length (sum of segment distances) for each data stroke.
    const strokeLengths = dataStrokes.map((s: any) => computeMedianPathLength(s.points));
    const strokeDurations = strokeLengths.map(
      (len: number) => (len / HANZI_COORD_SIZE) * BASE_STROKE_DURATION,
    );

    // Calculate delay for each data stroke based on groups.
    // Strokes within the same group get the SAME delay (start simultaneously),
    // just like animCJK does for sub-strokes (e.g. --d:3s for both 3a and 3b).
    const strokeDelays: number[] = Array.from({ length: dataStrokes.length }, () => 0);
    let currentDelay = 0;
    for (let gi = 0; gi < resolvedStrokeGroups.length; gi++) {
      if (gi > 0) {
        currentDelay += delayBetweenStrokes / 1000;
      }
      const groupDelay = currentDelay;
      let groupMaxDuration = 0;
      for (const dataIdx of resolvedStrokeGroups[gi]) {
        if (dataIdx < 0 || dataIdx >= dataStrokes.length) {
          continue;
        }
        strokeDelays[dataIdx] = groupDelay;
        if (strokeDurations[dataIdx] > groupMaxDuration) {
          groupMaxDuration = strokeDurations[dataIdx];
        }
      }
      currentDelay += groupMaxDuration;
    }
    // totalTime = max end time across all data strokes (handles incomplete strokeGroups).
    let totalTime = 0;
    for (let i = 0; i < dataStrokes.length; i++) {
      const end = strokeDelays[i] + strokeDurations[i];
      if (end > totalTime) {
        totalTime = end;
      }
    }

    // Build overlay SVG (exact animCJK structure)
    const ns = "http://www.w3.org/2000/svg";
    const overlaySvg = document.createElementNS(ns, "svg");
    overlaySvg.classList.add("kakitori-anim");
    overlaySvg.setAttribute("width", width);
    overlaySvg.setAttribute("height", height);
    // Layer the overlay above hanzi-writer's SVG (z-index: 1) so the
    // animation paints on top even if hwSvg's visibility is briefly toggled
    // back. The grid SVG sits as a separate sibling behind both and stays
    // visible through the overlay's transparent regions.
    overlaySvg.style.position = "absolute";
    overlaySvg.style.top = "0";
    overlaySvg.style.left = "0";
    overlaySvg.style.zIndex = "2";
    overlaySvg.style.pointerEvents = "none";

    // Copy HanziWriter's exact coordinate transform (includes padding, scale, and Y-flip)
    const hwGroup = localHwSvg.querySelector(":scope > g");
    const hwTransform = hwGroup?.getAttribute("transform") || "";

    const flipGroup = document.createElementNS(ns, "g");
    flipGroup.setAttribute("transform", hwTransform);

    // CSS style (embedded like animCJK)
    const styleEl = document.createElementNS(ns, "style");
    styleEl.textContent = `
      @keyframes kakitori-zk {
        to {
          stroke-dashoffset: 0;
        }
      }
      svg.kakitori-anim path[clip-path] {
        animation: kakitori-zk var(--t) linear forwards var(--d);
        stroke-dasharray: ${DASH_ARRAY};
        stroke-dashoffset: ${DASH_OFFSET};
        stroke-width: 128;
        stroke-linecap: round;
        fill: none;
        stroke: ${strokeColor};
      }
      svg.kakitori-anim path[id] { fill: ${outlineColor}; }
    `;
    overlaySvg.appendChild(styleEl);

    const defs = document.createElementNS(ns, "defs");

    // Shape paths (outlines) and clip-paths
    for (let i = 0; i < dataStrokes.length; i++) {
      const stroke = dataStrokes[i];

      // Shape path (background)
      const shapePath = document.createElementNS(ns, "path");
      shapePath.id = `kakitori-d${i}`;
      shapePath.setAttribute("d", stroke.path);
      flipGroup.appendChild(shapePath);

      // Clip-path referencing shape
      const clipPath = document.createElementNS(ns, "clipPath");
      clipPath.id = `kakitori-c${i}`;
      const useEl = document.createElementNS(ns, "use");
      useEl.setAttribute("href", `#kakitori-d${i}`);
      clipPath.appendChild(useEl);
      defs.appendChild(clipPath);
    }

    // Animated median paths
    for (let i = 0; i < dataStrokes.length; i++) {
      const stroke = dataStrokes[i];
      const medianPath = document.createElementNS(ns, "path");
      medianPath.setAttribute("pathLength", String(PATH_LENGTH));
      medianPath.setAttribute("clip-path", `url(#kakitori-c${i})`);
      medianPath.style.setProperty("--d", `${strokeDelays[i]}s`);
      medianPath.style.setProperty("--t", `${strokeDurations[i]}s`);

      // Build median path from stroke points
      const d = stroke.points
        .map((p: any, j: number) => `${j === 0 ? "M" : "L"}${p.x} ${p.y}`)
        .join("");
      medianPath.setAttribute("d", d);

      flipGroup.appendChild(medianPath);
    }

    overlaySvg.appendChild(defs);
    overlaySvg.appendChild(flipGroup);

    try {
      // Atomic swap: drop any prior overlay from a still-running superseded
      // run, claim ownership, hide HanziWriter, and append our overlay
      // synchronously so the user never sees a blank frame.
      activeOverlay?.remove();
      activeOverlay = overlaySvg;
      // Use visibility (not display) so hanzi-writer's SVG keeps occupying
      // layout space; the grid SVG (a separate sibling) stays visible.
      localHwSvg.style.visibility = "hidden";
      layerEl.appendChild(overlaySvg);

      log?.(`animate: ${resolvedStrokeGroups.length} strokes (${dataStrokes.length} data strokes), totalTime=${totalTime.toFixed(1)}s`);

      await new Promise((r) => setTimeout(r, totalTime * 1000 + 200));
    } finally {
      // Only clean up if we are still the active overlay; a superseded run
      // leaves the new overlay alone. Note that if getCharacterData() rejects
      // before the swap above, activeOverlay was never set to ours, so this
      // branch is skipped and any prior run's cleanup proceeds normally.
      if (activeOverlay === overlaySvg) {
        overlaySvg.remove();
        activeOverlay = null;
        localHwSvg.style.visibility = "";
      }
    }
  }

  function startAnimation(): void {
    // Always go through animateWithGroups: the overlay-based animation
    // derives per-stroke duration from the median length, while
    // hanzi-writer's built-in animateCharacter uses (length + 600) / 3 ms,
    // whose +600 baseline flattens long strokes against short ones.
    // animateWithGroups is async; swallow any rejection (e.g. getCharacterData
    // failure) into the logger so it does not surface as an unhandled rejection.
    animateWithGroups().catch((err: unknown) => {
      log?.(`animate failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /**
   * Get the main stroke path elements from HanziWriter's SVG.
   * HanziWriter has 3 groups with clip-path paths: outline, main, highlight.
   * We want the "main" group (second one) for coloring.
   * Returns paths in data stroke order.
   */
  function getStrokePaths(): SVGPathElement[] {
    const svg = hwSvg;
    if (!svg) {
      return [];
    }
    const allGroups = svg.querySelectorAll(":scope > g > g");
    const groupsWithPaths: Element[] = [];
    for (const g of allGroups) {
      if (g.querySelectorAll("path[clip-path]").length > 0) {
        groupsWithPaths.push(g);
      }
    }
    // Main character group is the second group (index 1): outline=0, main=1, highlight=2
    const mainGroup = groupsWithPaths[1];
    if (!mainGroup) {
      return [];
    }
    return Array.from(mainGroup.querySelectorAll("path[clip-path]")) as SVGPathElement[];
  }

  // === public methods ===
  function ready(): Promise<void> {
    assertNotDestroyed();
    return configReady;
  }

  function getStrokeEndings(): readonly StrokeEnding[] | null {
    assertNotDestroyed();
    return strokeEndings;
  }

  function getStrokeGroups(): readonly number[][] | null {
    assertNotDestroyed();
    return strokeGroups;
  }

  function setStrokeGroups(next: number[][]): void {
    assertNotDestroyed();
    strokeGroups = next;
  }

  function setStrokeEndings(next: StrokeEnding[]): void {
    assertNotDestroyed();
    strokeEndings = next;
  }

  function start(): void {
    assertNotDestroyed();
    configReady.then(() => {
      if (destroyed) {
        return;
      }
      startQuiz();
    });
  }

  function animate(): void {
    assertNotDestroyed();
    configReady.then(() => {
      if (destroyed) {
        return;
      }
      startAnimation();
    });
  }

  function hideCharacter(): void {
    assertNotDestroyed();
    hw.hideCharacter();
  }

  function showCharacter(): void {
    assertNotDestroyed();
    hw.showCharacter();
  }

  function showOutline(): void {
    assertNotDestroyed();
    hw.showOutline();
  }

  function hideOutline(): void {
    assertNotDestroyed();
    hw.hideOutline();
  }

  function getStrokeIndexAtPoint(clientX: number, clientY: number): number | null {
    assertNotDestroyed();
    const svg = hwSvg;
    if (!svg) {
      return null;
    }
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !(el instanceof SVGPathElement)) {
      return null;
    }
    // The clicked element could be from any group (outline, main, highlight).
    // All groups have the same stroke order. Find which clip-path it uses,
    // then determine the data stroke index from the clip-path id.
    const clipAttr = el.getAttribute("clip-path");
    if (!clipAttr) {
      return null;
    }
    // Extract mask id: url("...#mask-25") -> mask-25
    const match = clipAttr.match(/#([^")\s]+)/);
    if (!match) {
      return null;
    }
    const maskId = match[1];

    // Find all clip-paths in defs and determine the stroke index
    const clipPaths = svg.querySelectorAll("defs clipPath");
    const strokeCount = getStrokePaths().length;
    for (let i = 0; i < clipPaths.length; i++) {
      if (clipPaths[i].id === maskId) {
        // clip-paths repeat for each group (outline, main, highlight),
        // so mod by stroke count to get the data stroke index
        const dataIdx = i % strokeCount;
        return getLogicalStrokeNum(dataIdx);
      }
    }

    return null;
  }

  function setStrokeColor(logicalStrokeNum: number, color: string = "#FF0000"): void {
    assertNotDestroyed();
    const strokePaths = getStrokePaths();
    const dataIndices = strokeGroups
      ? strokeGroups[logicalStrokeNum] ?? []
      : [logicalStrokeNum];

    for (const dataIdx of dataIndices) {
      const path = strokePaths[dataIdx];
      if (path) {
        if (path.dataset.kakitoriOriginalStroke === undefined) {
          path.dataset.kakitoriOriginalStroke = path.style.stroke || "";
        }
        path.style.stroke = color;
      }
    }
  }

  function resetStrokeColor(logicalStrokeNum: number): void {
    assertNotDestroyed();
    const strokePaths = getStrokePaths();
    const dataIndices = strokeGroups
      ? strokeGroups[logicalStrokeNum] ?? []
      : [logicalStrokeNum];

    for (const dataIdx of dataIndices) {
      const path = strokePaths[dataIdx];
      if (path && path.dataset.kakitoriOriginalStroke !== undefined) {
        path.style.stroke = path.dataset.kakitoriOriginalStroke;
        delete path.dataset.kakitoriOriginalStroke;
      }
    }
  }

  function resetStrokeColors(): void {
    assertNotDestroyed();
    const strokePaths = getStrokePaths();
    for (const path of strokePaths) {
      if (path.dataset.kakitoriOriginalStroke !== undefined) {
        path.style.stroke = path.dataset.kakitoriOriginalStroke;
        delete path.dataset.kakitoriOriginalStroke;
      }
    }
  }

  function getLogicalStrokeCount(): number {
    assertNotDestroyed();
    if (strokeGroups) {
      return strokeGroups.length;
    }
    return getStrokePaths().length;
  }

  async function setCharacter(c: string): Promise<void> {
    assertNotDestroyed();
    currentCharacter = c;
    strokeEndings = null;
    strokeEndingMistakes = 0;
    pendingEndingJudgment = null;
    await hw.setCharacter(c);
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }
    destroyed = true;
    stopTimingTracking();
    if (boundOnClick) {
      targetEl.removeEventListener("click", boundOnClick);
      boundOnClick = null;
    }
    targetEl.innerHTML = "";
    characterData = null;
  }

  // === construction ===
  let currentCharacter = character;

  // Auto-load config from @k1low/kakitori-data unless disabled (null)
  const loader = options.configLoader === null
    ? null
    : options.configLoader ?? defaultConfigLoader;
  let configReady: Promise<void>;
  if (loader) {
    configReady = Promise.resolve()
      .then(() => loader(currentCharacter))
      .then((config) => {
        if (destroyed) {
          return;
        }
        if (!config) {
          return;
        }
        log?.(`config loaded: ${JSON.stringify(config)}`);
        // Preserve any stroke groups already set on the instance
        if (strokeGroups == null && config.strokeGroups) {
          strokeGroups = config.strokeGroups;
        }
        if (!strokeEndings && config.strokeEndings) {
          strokeEndings = config.strokeEndings ?? null;
        }
      })
      .catch((error) => {
        if (destroyed) {
          return;
        }
        log?.(
          `config load failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  } else {
    configReady = Promise.resolve();
  }

  const targetEl: HTMLElement = typeof target === "string"
    ? document.querySelector(target) as HTMLElement
    : target;

  const size = options.size ?? DEFAULT_SIZE;
  const padding = options.padding ?? DEFAULT_PADDING;
  validateSizeAndPadding(size, padding, "char.create()");
  const hwOptions: Record<string, unknown> = {
    width: size,
    height: size,
    padding,
    charDataLoader: options.charDataLoader ?? defaultCharDataLoader,
  };

  if (options.strokeColor != null) {
    hwOptions.strokeColor = options.strokeColor;
  }
  if (options.outlineColor != null) {
    hwOptions.outlineColor = options.outlineColor;
  }
  if (options.drawingColor != null) {
    hwOptions.drawingColor = options.drawingColor;
  }
  if (options.drawingWidth != null) {
    hwOptions.drawingWidth = options.drawingWidth;
  }
  if (options.highlightColor != null) {
    hwOptions.highlightColor = options.highlightColor;
  }
  if (options.showOutline != null) {
    hwOptions.showOutline = options.showOutline;
  }
  if (options.showCharacter != null) {
    hwOptions.showCharacter = options.showCharacter;
  }
  if (options.strokeAnimationSpeed != null) {
    hwOptions.strokeAnimationSpeed = options.strokeAnimationSpeed;
  }
  if (options.delayBetweenStrokes != null) {
    hwOptions.delayBetweenStrokes = options.delayBetweenStrokes;
  }
  // Wrap hanzi-writer's SVG in a positioned layer container so the optional
  // grid SVG and the animate() overlay can layer onto it without mutating
  // the user-supplied targetEl. destroy() clears targetEl.innerHTML, which
  // also drops this wrapper, so no host-element style is ever left behind.
  layerEl = document.createElement("div");
  layerEl.style.position = "relative";
  layerEl.style.display = "inline-block";
  layerEl.style.lineHeight = "0";
  targetEl.appendChild(layerEl);

  const hw = HanziWriter.create(layerEl, currentCharacter, hwOptions as any);

  const initialHwSvg = layerEl.querySelector("svg") as SVGSVGElement | null;
  if (initialHwSvg) {
    // Stacking inside layerEl uses explicit z-index values:
    //   gridSvg  (auto, default)  -> background
    //   hwSvg    (z-index: 1)     -> character outline + user-drawn strokes
    //   overlaySvg (z-index: 2)   -> animate() animation, on top of hwSvg
    // hwSvg needs position: relative so the z-index actually applies.
    initialHwSvg.style.position = "relative";
    initialHwSvg.style.zIndex = "1";
    hwSvg = initialHwSvg;
  }

  if (options.showGrid) {
    const ns = "http://www.w3.org/2000/svg";
    const initialGridSvg = document.createElementNS(ns, "svg");
    initialGridSvg.classList.add("kakitori-grid");
    initialGridSvg.setAttribute("width", String(size));
    initialGridSvg.setAttribute("height", String(size));
    // Decorative; hide from assistive technologies so the writer surfaces a
    // single accessible graphic rather than two.
    initialGridSvg.setAttribute("aria-hidden", "true");
    initialGridSvg.style.position = "absolute";
    initialGridSvg.style.top = "0";
    initialGridSvg.style.left = "0";
    initialGridSvg.style.pointerEvents = "none";
    drawCrossGrid(initialGridSvg, size, options.showGrid);
    // Insert before hwSvg so grid is the first child; since hwSvg is the
    // only z-indexed sibling, the grid implicitly stacks behind it.
    layerEl.insertBefore(initialGridSvg, layerEl.firstChild);
    gridSvg = initialGridSvg;
  }

  if (options.onClick) {
    boundOnClick = (e: MouseEvent) => {
      const strokeIndex = getStrokeIndexAtPoint(e.clientX, e.clientY);
      options.onClick!({ character: currentCharacter, strokeIndex });
    };
    targetEl.addEventListener("click", boundOnClick);
  }

  // Reference unused gridSvg binding to keep the closure shape stable for
  // future use (e.g. dynamic grid toggling). Currently the grid is set up
  // once and not mutated after construction.
  void gridSvg;

  return {
    ready,
    start,
    animate,
    hideCharacter,
    showCharacter,
    showOutline,
    hideOutline,
    getStrokeEndings,
    getStrokeGroups,
    setStrokeGroups,
    setStrokeEndings,
    getStrokeIndexAtPoint,
    setStrokeColor,
    resetStrokeColor,
    resetStrokeColors,
    getLogicalStrokeCount,
    setCharacter,
    destroy,
  };
}

function renderImpl(
  target: string | HTMLElement,
  character: string,
  options: RenderOptions = {},
): void {
  const el = typeof target === "string"
    ? document.querySelector(target)
    : target;
  if (!el) {
    throw new Error(`char.render(): target selector "${target}" did not match any element.`);
  }
  const size = options.size ?? DEFAULT_SIZE;
  const padding = options.padding ?? DEFAULT_PADDING;
  validateSizeAndPadding(size, padding, "char.render()");
  const loader = options.charDataLoader ?? defaultCharDataLoader;

  loader(
    character,
    (data) => {
      const strokeColor = options.strokeColor ?? "#555";

      const scale = (size - 2 * padding) / HANZI_COORD_SIZE;

      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));

      // Draw the grid first so it sits behind the character strokes,
      // matching the layering used by char.create().
      if (options.showGrid) {
        drawCrossGrid(svg, size, options.showGrid);
      }

      const g = document.createElementNS(ns, "g");
      g.setAttribute(
        "transform",
        `translate(${padding}, ${size - padding}) scale(${scale}, ${-scale})`,
      );

      for (const d of data.strokes) {
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", strokeColor);
        g.appendChild(path);
      }

      svg.appendChild(g);

      el.appendChild(svg);

      if (options.onClick) {
        svg.style.cursor = "pointer";
        svg.addEventListener("click", () => {
          options.onClick!({ character });
        });
      }
    },
    (err) => { console.error(`char.render(): failed to load "${character}"`, err); },
  );
}

export const char = {
  /**
   * Create a new Char instance with full HanziWriter integration.
   * @example
   * const c = char.create('#target', 'あ', { size: 300 });
   * c.start();
   */
  create: createImpl,
  /**
   * Render a character as a lightweight static SVG without HanziWriter.
   * @example
   * char.render('#target', 'あ', { size: 60, onClick: ({ character }) => console.log(character) });
   */
  render: renderImpl,
};
