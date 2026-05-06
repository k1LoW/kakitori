import HanziWriter, { type HanziWriterOptions } from "hanzi-writer";
import type {
  CharCreateOptions,
  CharJudgeResult,
  CharJudgeStrokeOptions,
  CharJudgeStrokeResult,
  CharLogger,
  GridOptions,
  MountOptions,
  RenderOptions,
} from "./charOptions.js";
import type {
  CharStrokeData,
  StrokeEnding,
  StrokeEndingJudgment,
} from "./types.js";
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
import type {
  HanziCharacterData,
  HanziQuiz,
  Pt,
  QuizStrokeMeta,
} from "./hanziWriterInternals.js";

const DEFAULT_GRID_COLOR = "#ccc";
const DEFAULT_GRID_DASH = "10,10";
const DEFAULT_GRID_WIDTH = 2;

// hanzi-writer's stroke matcher thresholds, hard-coded inside its source.
// We mirror them here to derive a similarity score from
// `Stroke.getAverageDistance` without re-running the matcher.
const HW_AVERAGE_DISTANCE_THRESHOLD = 350;

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
 * Project drawn points from a source coordinate-space square into the
 * hanzi-writer internal `[0, HANZI_COORD_SIZE]` square. Source is assumed
 * to be Y-down (browser/SVG); internal is Y-up (math), so the y axis is
 * flipped during projection.
 */
function projectToInternal(
  points: ReadonlyArray<Pt>,
  sourceBox: { x: number; y: number; size: number },
): Pt[] {
  if (sourceBox.size <= 0 || !Number.isFinite(sourceBox.size)) {
    throw new Error(
      `char.judge(): sourceBox.size must be a positive finite number, got ${sourceBox.size}`,
    );
  }
  const scale = HANZI_COORD_SIZE / sourceBox.size;
  return points.map((p) => ({
    x: (p.x - sourceBox.x) * scale,
    y: HANZI_COORD_SIZE - (p.y - sourceBox.y) * scale,
  }));
}

/**
 * A Char instance: a 1-character abstraction. Headless by default in the
 * sense that there is no visible on-screen mount, though judge() still
 * requires a DOM environment because it lazily mounts an offscreen
 * (hidden) container so hanzi-writer's matcher can run. Call
 * {@link Char.mount} to attach the character to a `target` element for
 * interactive practice and rendering.
 */
export interface Char {
  /** Wait for the async config (strokeGroups, strokeEndings) to finish loading. */
  ready(): Promise<void>;

  // ───── headless judge API ─────
  /**
   * Judge a single drawn stroke against the corresponding character stroke.
   * `strokeNum` is the logical stroke index (respects `strokeGroups` when
   * configured). Resolves with the per-stroke result.
   *
   * `points` must be in hanzi-writer's internal coord space
   * (`[0, HANZI_COORD_SIZE]`, Y-up) unless `opts.sourceBox` is provided —
   * in that case judge() projects from the source square (Y-down /
   * browser convention) into internal coords. Pass the SAME `sourceBox`
   * for every stroke of one character so the spatial relationship between
   * strokes is preserved.
   *
   * Pass `opts.timing` to also obtain a tome/hane/harai judgment for the
   * current stroke.
   *
   * Records the result on the instance so {@link Char.result} returns the
   * cumulative judgment of every stroke judged so far.
   *
   * Throws when called on a mounted instance — judge and mount are
   * intentionally exclusive (use a separate Char for each role).
   */
  judge(
    strokeNum: number,
    points: Pt[],
    opts?: CharJudgeStrokeOptions,
  ): Promise<CharJudgeStrokeResult>;
  /**
   * Cumulative judgment built up by previous {@link Char.judge} calls.
   *
   * `matched` is true when at least one stroke has been judged AND every
   * judged stroke matched. Before any judge() call, `matched` is `false`
   * (the call has nothing to attest to). Strokes that have not been judged
   * are absent from `perStroke`; it has the highest index judged + 1
   * entries with gaps filled by `{ matched: false, similarity: 0 }`
   * placeholders.
   */
  result(): CharJudgeResult;

  // ───── configuration (works headless) ─────
  /** Return the stroke endings loaded from config, or null if not loaded. */
  getStrokeEndings(): readonly StrokeEnding[] | null;
  /** Override stroke endings. Returns the same Char for chaining. */
  setStrokeEndings(strokeEndings: StrokeEnding[]): Char;
  /** Return the stroke groups loaded from config, or null if not loaded. */
  getStrokeGroups(): readonly number[][] | null;
  /** Override stroke groups. Returns the same Char for chaining. */
  setStrokeGroups(strokeGroups: number[][]): Char;
  /**
   * Total logical stroke count. Returns `strokeGroups.length` when groups
   * are configured; otherwise needs a mounted SVG to count main-group paths
   * (returns 0 before mount when groups are unconfigured).
   */
  getLogicalStrokeCount(): number;
  /** Change the displayed character. Resets stroke endings and judge result. */
  setCharacter(c: string): Promise<Char>;

  // ───── mount lifecycle ─────
  /**
   * Mount the character to a DOM element for interactive practice
   * (start / animate / etc.). Returns the same Char instance so callers
   * can chain `char.create(...).mount(...).start()`. Throws when judge()
   * has already been called on this instance.
   */
  mount(target: string | HTMLElement, mountOpts?: MountOptions): Char;
  /** Unmount from the DOM. The Char remains usable for headless config edits. Returns the same Char for chaining. */
  unmount(): Char;
  /** True between mount() and unmount(). */
  isMounted(): boolean;

  // ───── DOM-bound (require mount) ─────
  /** Start writing practice with stroke order and stroke ending judgment. Returns the same Char for chaining. */
  start(): Char;
  /**
   * Play stroke-order animation. Always uses the animCJK-style overlay so
   * each stroke's duration is proportional to its median length; defaults to
   * one-stroke-per-group when strokeGroups is not configured. Returns the
   * same Char for chaining.
   */
  animate(): Char;
  /**
   * Return to a clean rest state on the mounted surface: cancel any
   * in-flight animate() overlay, cancel any active quiz (drops pointer
   * listeners and per-run counters), and clear any custom stroke colors
   * applied via {@link setStrokeColor} back to their original values. The
   * current character and configured strokeEndings / strokeGroups stay in
   * place. Returns the same Char for chaining.
   */
  reset(): Char;
  /** Hide the character strokes. Returns the same Char for chaining. */
  hideCharacter(): Char;
  /** Show the character strokes. Returns the same Char for chaining. */
  showCharacter(): Char;
  /** Show the character outline (light gray background). Returns the same Char for chaining. */
  showOutline(): Char;
  /** Hide the character outline. Returns the same Char for chaining. */
  hideOutline(): Char;
  /** Set the color of a logical stroke. Returns the same Char for chaining. */
  setStrokeColor(logicalStrokeNum: number, color?: string): Char;
  /** Reset a single logical stroke's color to its original value. Returns the same Char for chaining. */
  resetStrokeColor(logicalStrokeNum: number): Char;
  /** Reset all stroke colors to their original values. Returns the same Char for chaining. */
  resetStrokeColors(): Char;
  /**
   * Get the logical stroke index at a given point (client coordinates).
   * Uses document.elementFromPoint for accurate hit detection that respects
   * clip-paths and actual rendered output. Returns null if no stroke found.
   */
  getStrokeIndexAtPoint(clientX: number, clientY: number): number | null;

  // ───── teardown ─────
  /**
   * Clean up event listeners, remove the rendered SVG (if mounted), tear
   * down any offscreen judging instance, and mark the Char as destroyed.
   * After destroy, calling any other public method throws. Idempotent.
   */
  destroy(): void;
}

interface MountState {
  targetEl: HTMLElement;
  layerEl: HTMLElement;
  hwSvg: SVGSVGElement | null;
  gridSvg: SVGSVGElement | null;
  activeOverlay: SVGSVGElement | null;
  pendingEndingJudgment: StrokeEndingJudgment | null;
  quizActive: boolean;
  strokeEndingMistakes: number;
  // pointer timing
  isPointerDown: boolean;
  lastMoveTime: number;
  releaseTime: number;
  timedPoints: Array<{ x: number; y: number; t: number }>;
  boundOnPointerDown: ((e: PointerEvent) => void) | null;
  boundOnPointerMove: ((e: PointerEvent) => void) | null;
  boundOnPointerUp: ((e: PointerEvent) => void) | null;
  boundOnClick: ((e: MouseEvent) => void) | null;
  options: MountOptions;
  hw: HanziWriter;
  size: number;
  padding: number;
}

interface JudgerState {
  container: HTMLDivElement;
  hw: HanziWriter;
  // hanzi-writer's Character instance (`Stroke[]`)
  character: { strokes: Array<{ getAverageDistance(points: Pt[]): number }> };
  // accumulated per-stroke results, indexed by logical stroke num
  perStroke: CharJudgeStrokeResult[];
  // patched-handler capture slot for the current judge() call
  capture: { matched: boolean; isBackwards: boolean } | null;
}

function createImpl(character: string, options: CharCreateOptions = {}): Char {
  // ===== always-present state =====
  let destroyed = false;
  let currentCharacter = character;
  let strokeEndings: StrokeEnding[] | null = null;
  let strokeGroups: number[][] | null = options.strokeGroups ?? null;
  let characterData: HanziCharacterData | null = null;
  const log: CharLogger | null = options.logger ?? null;
  const charDataLoader = options.charDataLoader ?? defaultCharDataLoader;
  const leniency = options.leniency;
  const strokeEndingStrictness = options.strokeEndingStrictness ?? 0.7;

  // mount-bound and judger-bound state are populated lazily.
  let mounted: MountState | null = null;
  let judger: JudgerState | null = null;
  // Shared promise for the in-flight judger initialisation. Set on the
  // first judge() call, cleared on failure so retries get a fresh chance.
  // Successful init also sets `judger`; later judge() calls short-circuit
  // on `judger` before they ever consult `judgerInit`.
  let judgerInit: Promise<JudgerState> | null = null;
  // Flips to true synchronously the moment judge() is called for the
  // first time. mount() checks this so judging-vs-mounting exclusivity
  // holds even before judge()'s first await has set `judgerInit`.
  let judgeStarted = false;

  // Monotonic counter bumped on every start() / animate() / reset() call.
  // configReady-deferred work captures the seq at scheduling time and bails
  // when a later call has superseded it.
  let requestSeq = 0;

  // ===== helpers =====
  function assertNotDestroyed(): void {
    if (destroyed) {
      throw new Error("char: instance has been destroyed and cannot be used.");
    }
  }
  function assertMounted(): MountState {
    assertNotDestroyed();
    if (!mounted) {
      throw new Error("char: not mounted. Call mount(target, opts) before this operation.");
    }
    return mounted;
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

  /** Map a logical stroke index to the first data stroke in its group. */
  function logicalToFirstDataStroke(logicalStrokeNum: number): number {
    if (!strokeGroups) {
      return logicalStrokeNum;
    }
    return strokeGroups[logicalStrokeNum]?.[0] ?? logicalStrokeNum;
  }

  // ===== timing tracking (mount only) =====
  function startTimingTracking(m: MountState): void {
    stopTimingTracking(m);
    m.boundOnPointerDown = (e: PointerEvent) => {
      m.isPointerDown = true;
      m.timedPoints = [];
      m.lastMoveTime = performance.now();
      m.releaseTime = 0;
      log?.(`pointerdown  x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}`);
    };
    m.boundOnPointerMove = (e: PointerEvent) => {
      if (!m.isPointerDown) {
        return;
      }
      const now = performance.now();
      const dt = (now - m.lastMoveTime).toFixed(0);
      m.lastMoveTime = now;
      m.timedPoints.push({ x: e.clientX, y: e.clientY, t: now });
      log?.(`pointermove  x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}  dt=${dt}ms`);
    };
    m.boundOnPointerUp = (e: PointerEvent) => {
      if (!m.isPointerDown) {
        return;
      }
      m.isPointerDown = false;
      m.releaseTime = performance.now();
      const pause = (m.releaseTime - m.lastMoveTime).toFixed(0);
      log?.(`pointerup    x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}  pause=${pause}ms`);
    };
    // Listen on the Char-owned layerEl (not targetEl) so pointer events on
    // unrelated sibling DOM the host placed inside targetEl never feed
    // into our timing tracker.
    m.layerEl.addEventListener("pointerdown", m.boundOnPointerDown);
    m.layerEl.addEventListener("pointermove", m.boundOnPointerMove);
    m.layerEl.addEventListener("pointerup", m.boundOnPointerUp);
  }
  function stopTimingTracking(m: MountState): void {
    if (m.boundOnPointerDown) {
      m.layerEl.removeEventListener("pointerdown", m.boundOnPointerDown);
      m.boundOnPointerDown = null;
    }
    if (m.boundOnPointerMove) {
      m.layerEl.removeEventListener("pointermove", m.boundOnPointerMove);
      m.boundOnPointerMove = null;
    }
    if (m.boundOnPointerUp) {
      m.layerEl.removeEventListener("pointerup", m.boundOnPointerUp);
      m.boundOnPointerUp = null;
    }
  }
  function getTimingData(m: MountState) {
    const pauseBeforeRelease =
      m.releaseTime > 0 && m.lastMoveTime > 0 ? m.releaseTime - m.lastMoveTime : 0;
    return {
      pauseBeforeRelease,
      timedPoints: [...m.timedPoints],
    };
  }

  // ===== ending judgment adapter (mount only) =====
  function runEndingJudgment(
    m: MountState,
    quiz: HanziQuiz,
    dataStrokeNum: number,
    meta: QuizStrokeMeta,
  ): StrokeEndingJudgment | null {
    const hwData = quiz._getStrokeData({ isCorrect: true, meta });
    return computeEndingJudgment({
      dataStrokeNum,
      drawnPoints: hwData.drawnPath.points,
      timing: getTimingData(m),
      strokeEndings,
      strokeGroups,
      characterData,
      drawableSize: m.size - 2 * m.padding,
      strictness: strokeEndingStrictness,
      log,
    });
  }

  function patchQuizForEnding(m: MountState): void {
    const quiz = (m.hw as unknown as { _quiz?: HanziQuiz })._quiz;
    if (!quiz) {
      return;
    }
    attachEndingJudgmentPatch(quiz, {
      runJudgment: (q, n, meta) => runEndingJudgment(m, q, n, meta),
      onMistake: (judgment, { quiz: q, dataStrokeNum, willAdvance, meta }) => {
        m.strokeEndingMistakes++;
        const hwData = q._getStrokeData({ isCorrect: willAdvance, meta });
        const logicalStrokeNum = getLogicalStrokeNum(dataStrokeNum);
        const charData: CharStrokeData = {
          character: currentCharacter,
          strokeNum: logicalStrokeNum,
          drawnPath: hwData.drawnPath,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: logicalStrokesRemaining(
            dataStrokeNum,
            hwData.strokesRemaining,
            willAdvance,
          ),
          strokeEnding: judgment,
        };
        m.options.onStrokeEndingMistake?.(charData);
      },
      onResolved: (j) => {
        m.pendingEndingJudgment = j;
      },
      strokeEndingAsMiss: !!m.options.strokeEndingAsMiss,
      log,
    });
  }

  function startQuiz(m: MountState): void {
    m.quizActive = true;
    m.strokeEndingMistakes = 0;
    m.pendingEndingJudgment = null;

    // Pre-load character data for direction auto-computation
    m.hw.getCharacterData().then((c) => {
      if (destroyed) {
        return;
      }
      characterData = c;
    });

    startTimingTracking(m);

    const quizPromise = m.hw.quiz({
      leniency,
      showHintAfterMisses: m.options.showHintAfterMisses,
      highlightOnComplete: m.options.highlightOnComplete,

      onCorrectStroke: (hwData) => {
        const dataStrokeNum = hwData.strokeNum;
        const logicalStrokeNum = getLogicalStrokeNum(dataStrokeNum);
        const isLast = isLastInGroup(dataStrokeNum);
        const skipsNeeded = getRemainingSkipsInGroup(dataStrokeNum);

        log?.(`stroke correct: data=${dataStrokeNum} logical=${logicalStrokeNum} isLast=${isLast} skips=${skipsNeeded}`);

        if (skipsNeeded > 0) {
          log?.(`auto-skipping ${skipsNeeded} stroke(s) in group`);
          for (let i = 0; i < skipsNeeded; i++) {
            m.hw.skipQuizStroke();
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

        if (m.pendingEndingJudgment != null) {
          charData.strokeEnding = m.pendingEndingJudgment;
          m.pendingEndingJudgment = null;
        }

        if (isFirstInGroup(dataStrokeNum) || !strokeGroups) {
          m.options.onCorrectStroke?.(charData);
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
        m.options.onMistake?.(charData);
      },

      onComplete: (summary) => {
        m.quizActive = false;
        stopTimingTracking(m);
        log?.(`complete: totalMistakes=${summary.totalMistakes} strokeEndingMistakes=${m.strokeEndingMistakes}`);
        m.options.onComplete?.({
          character: summary.character,
          totalMistakes: summary.totalMistakes,
          strokeEndingMistakes: m.strokeEndingMistakes,
        });
      },
    });

    Promise.resolve(quizPromise).then(() => {
      if (destroyed || mounted !== m) {
        return;
      }
      patchQuizForEnding(m);
    });
  }

  /** Build the animate-overlay and play it on top of the mounted SVG. */
  async function animateWithGroups(m: MountState): Promise<void> {
    const rawSpeed = m.options.strokeAnimationSpeed ?? 1;
    const speed = Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 1;
    if (speed !== rawSpeed) {
      log?.(`strokeAnimationSpeed must be a positive finite number, got ${rawSpeed}; falling back to 1`);
    }
    const delayBetweenStrokes = m.options.delayBetweenStrokes ?? 1000;
    const strokeColor = m.options.strokeColor ?? "#555";
    const outlineColor = m.options.outlineColor ?? "#DDD";

    const charData = (await m.hw.getCharacterData()) as unknown as HanziCharacterData;
    const dataStrokes = charData.strokes;

    const resolvedStrokeGroups = strokeGroups
      ?? Array.from({ length: dataStrokes.length }, (_, i) => [i]);

    const localHwSvg = m.hwSvg;
    if (!localHwSvg) {
      return;
    }
    const width = localHwSvg.getAttribute("width") || "300";
    const height = localHwSvg.getAttribute("height") || "300";

    const PATH_LENGTH = 3333;
    const DASH_ARRAY = 3337;
    const DASH_OFFSET = 3339;
    const BASE_STROKE_DURATION = 0.8 / speed;

    const strokeLengths = dataStrokes.map((s) =>
      computeMedianPathLength(s.points as Array<{ x: number; y: number }>),
    );
    const strokeDurations = strokeLengths.map(
      (len) => (len / HANZI_COORD_SIZE) * BASE_STROKE_DURATION,
    );

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
    let totalTime = 0;
    for (let i = 0; i < dataStrokes.length; i++) {
      const end = strokeDelays[i] + strokeDurations[i];
      if (end > totalTime) {
        totalTime = end;
      }
    }

    const ns = "http://www.w3.org/2000/svg";
    const overlaySvg = document.createElementNS(ns, "svg");
    overlaySvg.classList.add("kakitori-anim");
    overlaySvg.setAttribute("width", width);
    overlaySvg.setAttribute("height", height);
    overlaySvg.style.position = "absolute";
    overlaySvg.style.top = "0";
    overlaySvg.style.left = "0";
    overlaySvg.style.zIndex = "2";
    overlaySvg.style.pointerEvents = "none";

    const hwGroup = localHwSvg.querySelector(":scope > g");
    const hwTransform = hwGroup?.getAttribute("transform") || "";

    const flipGroup = document.createElementNS(ns, "g");
    flipGroup.setAttribute("transform", hwTransform);

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

    for (let i = 0; i < dataStrokes.length; i++) {
      const stroke = dataStrokes[i];
      const shapePath = document.createElementNS(ns, "path");
      shapePath.id = `kakitori-d${i}`;
      shapePath.setAttribute("d", stroke.path);
      flipGroup.appendChild(shapePath);

      const clipPath = document.createElementNS(ns, "clipPath");
      clipPath.id = `kakitori-c${i}`;
      const useEl = document.createElementNS(ns, "use");
      useEl.setAttribute("href", `#kakitori-d${i}`);
      clipPath.appendChild(useEl);
      defs.appendChild(clipPath);
    }

    for (let i = 0; i < dataStrokes.length; i++) {
      const stroke = dataStrokes[i];
      const medianPath = document.createElementNS(ns, "path");
      medianPath.setAttribute("pathLength", String(PATH_LENGTH));
      medianPath.setAttribute("clip-path", `url(#kakitori-c${i})`);
      medianPath.style.setProperty("--d", `${strokeDelays[i]}s`);
      medianPath.style.setProperty("--t", `${strokeDurations[i]}s`);
      const d = stroke.points
        .map((p, j) => `${j === 0 ? "M" : "L"}${p.x} ${p.y}`)
        .join("");
      medianPath.setAttribute("d", d);
      flipGroup.appendChild(medianPath);
    }

    overlaySvg.appendChild(defs);
    overlaySvg.appendChild(flipGroup);

    try {
      m.activeOverlay?.remove();
      m.activeOverlay = overlaySvg;
      localHwSvg.style.visibility = "hidden";
      m.layerEl.appendChild(overlaySvg);

      log?.(`animate: ${resolvedStrokeGroups.length} strokes (${dataStrokes.length} data strokes), totalTime=${totalTime.toFixed(1)}s`);

      await new Promise((r) => setTimeout(r, totalTime * 1000 + 200));
    } finally {
      if (m.activeOverlay === overlaySvg) {
        overlaySvg.remove();
        m.activeOverlay = null;
        localHwSvg.style.visibility = "";
      }
    }
  }

  function startAnimation(m: MountState): void {
    animateWithGroups(m).catch((err: unknown) => {
      log?.(`animate failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  function getStrokePaths(m: MountState): SVGPathElement[] {
    const svg = m.hwSvg;
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
    const mainGroup = groupsWithPaths[1];
    if (!mainGroup) {
      return [];
    }
    return Array.from(mainGroup.querySelectorAll("path[clip-path]")) as SVGPathElement[];
  }

  function cancelActiveAnimation(m: MountState): void {
    if (m.activeOverlay) {
      m.activeOverlay.remove();
      m.activeOverlay = null;
    }
    if (m.hwSvg) {
      m.hwSvg.style.visibility = "";
    }
  }

  function cancelActiveQuiz(m: MountState): void {
    const wasActive = m.quizActive;
    m.quizActive = false;
    m.hw.cancelQuiz();
    stopTimingTracking(m);
    m.strokeEndingMistakes = 0;
    m.pendingEndingJudgment = null;
    if (wasActive) {
      m.hw.setCharacter(currentCharacter).catch((err: unknown) => {
        log?.(`cancelActiveQuiz reload failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  // ===== judge implementation (offscreen HW) =====
  async function ensureJudger(): Promise<JudgerState> {
    assertNotDestroyed();
    if (mounted) {
      throw new Error(
        "char: judge() is not supported on a mounted instance. Create a separate Char (without mount) for judging.",
      );
    }
    if (judger) {
      return judger;
    }
    // Memoize the in-flight init so concurrent judge() calls (e.g.
    // Promise.all) share a single offscreen container instead of each
    // racing to create its own and leaking the losers.
    if (judgerInit) {
      return judgerInit;
    }
    judgerInit = (async (): Promise<JudgerState> => {
      // Off-screen container so hanzi-writer's renderer can mount and the
      // matcher (which runs through endUserStroke -> renderState) does not
      // throw on missing layout.
      //
      // Hiding strategy avoids any user-visible side effects:
      // - `position: fixed` keeps the box out of the document flow without
      //   risking a horizontal scrollbar (which `left: -9999px` can cause
      //   when the host page lacks `overflow-x: hidden`).
      // - `visibility: hidden` removes it from rendering and hit-testing.
      // - `pointer-events: none` belt-and-braces guard against stray events.
      // - `aria-hidden="true"` keeps the offscreen mount out of the a11y
      //   tree so screen readers do not see two copies of the character.
      // - `contain: strict` confines layout / paint to the box, so even
      //   the briefly-visible ancestors during hanzi-writer's render path
      //   cannot perturb the host page.
      const container = document.createElement("div");
      container.setAttribute("aria-hidden", "true");
      container.style.position = "fixed";
      container.style.top = "0";
      container.style.left = "0";
      container.style.width = `${HANZI_COORD_SIZE}px`;
      container.style.height = `${HANZI_COORD_SIZE}px`;
      container.style.visibility = "hidden";
      container.style.pointerEvents = "none";
      container.style.contain = "strict";
      document.body.appendChild(container);

      try {
        const hw = HanziWriter.create(container, currentCharacter, {
          width: HANZI_COORD_SIZE,
          height: HANZI_COORD_SIZE,
          padding: 0,
          charDataLoader,
          // Keep hint/highlight off so the matcher path stays as plain as
          // possible; tome/hane/harai judgment is layered on top of isMatch.
          showHintAfterMisses: false,
          highlightOnComplete: false,
          ...(leniency != null ? { leniency } : {}),
        });
        // hw.quiz() can return a Promise that rejects (e.g. when the
        // char-data loader fails). Capture the failure so the polling
        // loop below surfaces the underlying error instead of timing out
        // with a misleading "quiz did not initialise" message; also
        // attach a no-op catch so the rejection does not bubble up as an
        // unhandled rejection while the loop is still running.
        let quizFailure: unknown = null;
        Promise.resolve(hw.quiz({})).catch((err: unknown) => {
          quizFailure = err;
        });

        // Wait for the internal _quiz to be ready (hanzi-writer initialises
        // it asynchronously after the character data resolves).
        let quiz: HanziQuiz | undefined;
        for (let i = 0; i < 200 && !quiz; i++) {
          if (quizFailure) {
            throw quizFailure instanceof Error
              ? quizFailure
              : new Error(`char.judge(): hanzi-writer quiz init failed: ${String(quizFailure)}`);
          }
          quiz = (hw as unknown as { _quiz?: HanziQuiz })._quiz;
          if (!quiz) {
            await new Promise((r) => setTimeout(r, 5));
          }
        }
        if (!quiz) {
          if (quizFailure) {
            throw quizFailure instanceof Error
              ? quizFailure
              : new Error(`char.judge(): hanzi-writer quiz init failed: ${String(quizFailure)}`);
          }
          throw new Error("char.judge(): timed out waiting for hanzi-writer quiz to initialise.");
        }
        // The await above could have spanned a destroy() or mount() call.
        // Bail rather than leave a fully-initialised judger lying around
        // alongside a mounted writer or after teardown.
        if (destroyed) {
          throw new Error("char: instance has been destroyed and cannot be used.");
        }
        if (mounted) {
          throw new Error(
            "char: judge() is not supported on a mounted instance. Create a separate Char (without mount) for judging.",
          );
        }

        const characterImpl = (hw as unknown as {
          _character: { strokes: Array<{ getAverageDistance(points: Pt[]): number }> };
        })._character;

        const j: JudgerState = {
          container,
          hw,
          character: characterImpl,
          perStroke: [],
          capture: null,
        };

        // Patch the success / failure handlers so we capture the matcher's
        // verdict without letting hanzi-writer's render-state side effects
        // advance internal stroke counters; the judger drives the index
        // manually instead.
        quiz._handleSuccess = (meta) => {
          j.capture = { matched: true, isBackwards: meta.isStrokeBackwards };
        };
        quiz._handleFailure = (meta) => {
          j.capture = { matched: false, isBackwards: meta.isStrokeBackwards };
        };

        judger = j;
        return j;
      } catch (err) {
        // Drop the container so a future judge() can retry from scratch
        // instead of leaving an orphaned hidden node behind.
        container.remove();
        // Clear the memo so the next judge() retries instead of always
        // reusing the failed promise.
        judgerInit = null;
        throw err;
      }
    })();
    return judgerInit;
  }

  async function judge(
    strokeNum: number,
    points: Pt[],
    opts: CharJudgeStrokeOptions = {},
  ): Promise<CharJudgeStrokeResult> {
    assertNotDestroyed();
    if (mounted) {
      throw new Error(
        "char: judge() is not supported on a mounted instance. Create a separate Char (without mount) for judging.",
      );
    }
    if (!Number.isInteger(strokeNum) || strokeNum < 0) {
      throw new Error(`char.judge(): strokeNum must be a non-negative integer, got ${strokeNum}`);
    }
    // Flag synchronously so a mount() called immediately after judge()
    // (before any await unfreezes ensureJudger) still sees that judging
    // has started.
    judgeStarted = true;
    await configReady;
    const j = await ensureJudger();

    const dataStrokeNum = logicalToFirstDataStroke(strokeNum);
    const quiz = (j.hw as unknown as { _quiz?: HanziQuiz })._quiz;
    if (!quiz) {
      throw new Error("char.judge(): hanzi-writer quiz disappeared between calls.");
    }

    // If a sourceBox was provided, project each point into hanzi-writer's
    // internal coord space (`[0, HANZI_COORD_SIZE]` with Y-up). Otherwise
    // assume the caller has already done the projection.
    const internalPoints = opts.sourceBox
      ? projectToInternal(points, opts.sourceBox)
      : points.map((p) => ({ x: p.x, y: p.y }));

    // Drive the matcher: position the quiz at the requested stroke, set the
    // user stroke to the projected points, and let endUserStroke run
    // strokeMatches. The patched handlers capture the verdict.
    quiz._currentStrokeIndex = dataStrokeNum;
    j.capture = null;
    quiz._userStroke = {
      points: internalPoints,
      externalPoints: internalPoints,
    };
    quiz.endUserStroke();

    const captured = j.capture ?? { matched: false, isBackwards: false };

    // Similarity is derived from `Stroke.getAverageDistance` (publicly typed
    // on hanzi-writer). 0 distance → 1.0; clamps to 0 once distance reaches
    // hanzi-writer's averageDistanceThreshold.
    const stroke = j.character.strokes[dataStrokeNum];
    const avgDist = stroke ? stroke.getAverageDistance(internalPoints) : Infinity;
    const threshold = HW_AVERAGE_DISTANCE_THRESHOLD * (leniency ?? 1);
    const similarity = threshold > 0 ? Math.max(0, Math.min(1, 1 - avgDist / threshold)) : 0;

    // Stroke ending judgment requires both configured strokeEndings and a
    // timing record for the current stroke. Lazily fetch character data for
    // the direction auto-derivation if it has not been loaded yet.
    let strokeEnding: StrokeEndingJudgment | undefined;
    if (strokeEndings && opts.timing) {
      if (!characterData) {
        characterData = (await j.hw.getCharacterData()) as unknown as HanziCharacterData;
      }
      const judgement = computeEndingJudgment({
        dataStrokeNum,
        drawnPoints: internalPoints,
        timing: opts.timing,
        strokeEndings,
        strokeGroups,
        characterData,
        drawableSize: HANZI_COORD_SIZE,
        strictness: strokeEndingStrictness,
        log,
      });
      if (judgement) {
        strokeEnding = judgement;
      }
    }

    const strokeResult: CharJudgeStrokeResult = strokeEnding
      ? { matched: captured.matched, similarity, strokeEnding }
      : { matched: captured.matched, similarity };

    j.perStroke[strokeNum] = strokeResult;
    return strokeResult;
  }

  function result(): CharJudgeResult {
    assertNotDestroyed();
    const empty: CharJudgeStrokeResult = { matched: false, similarity: 0 };
    const perStroke: CharJudgeStrokeResult[] = [];
    if (judger) {
      for (let i = 0; i < judger.perStroke.length; i++) {
        perStroke.push(judger.perStroke[i] ?? empty);
      }
    }
    const matched = perStroke.length > 0 && perStroke.every((r) => r.matched);
    return { matched, perStroke };
  }

  // ===== mount lifecycle =====
  function mount(target: string | HTMLElement, mountOpts: MountOptions = {}): Char {
    assertNotDestroyed();
    // judgeStarted flips synchronously when judge() is first called, even
    // before ensureJudger() runs and assigns judgerInit / judger. All
    // three together cover the windows "before the first await", "during
    // init" and "after init succeeded", so the documented mount/judge
    // exclusivity holds end-to-end.
    if (judger || judgerInit || judgeStarted) {
      throw new Error(
        "char: mount() is not supported after judge() has been called. Create a separate Char for mounting.",
      );
    }
    if (mounted) {
      unmount();
    }
    let targetEl: HTMLElement;
    if (typeof target === "string") {
      const found = document.querySelector(target);
      if (!found) {
        throw new Error(`char.mount(): target selector "${target}" did not match any element.`);
      }
      targetEl = found as HTMLElement;
    } else {
      targetEl = target;
    }

    const size = mountOpts.size ?? DEFAULT_SIZE;
    const padding = mountOpts.padding ?? DEFAULT_PADDING;
    validateSizeAndPadding(size, padding, "char.mount()");

    const hwOptions: Partial<HanziWriterOptions> = {
      width: size,
      height: size,
      padding,
      charDataLoader,
    };
    if (mountOpts.strokeColor != null) {
      hwOptions.strokeColor = mountOpts.strokeColor;
    }
    if (mountOpts.outlineColor != null) {
      hwOptions.outlineColor = mountOpts.outlineColor;
    }
    if (mountOpts.drawingColor != null) {
      hwOptions.drawingColor = mountOpts.drawingColor;
    }
    if (mountOpts.drawingWidth != null) {
      hwOptions.drawingWidth = mountOpts.drawingWidth;
    }
    if (mountOpts.highlightColor != null) {
      hwOptions.highlightColor = mountOpts.highlightColor;
    }
    if (mountOpts.showOutline != null) {
      hwOptions.showOutline = mountOpts.showOutline;
    }
    if (mountOpts.showCharacter != null) {
      hwOptions.showCharacter = mountOpts.showCharacter;
    }
    if (mountOpts.strokeAnimationSpeed != null) {
      hwOptions.strokeAnimationSpeed = mountOpts.strokeAnimationSpeed;
    }
    if (mountOpts.delayBetweenStrokes != null) {
      hwOptions.delayBetweenStrokes = mountOpts.delayBetweenStrokes;
    }

    // Wrap hanzi-writer's SVG in a positioned layer container so the optional
    // grid SVG and the animate() overlay can layer onto it without mutating
    // the user-supplied targetEl.
    const layerEl = document.createElement("div");
    layerEl.style.position = "relative";
    layerEl.style.display = "inline-block";
    layerEl.style.lineHeight = "0";
    targetEl.appendChild(layerEl);

    const hw = HanziWriter.create(layerEl, currentCharacter, hwOptions);

    let hwSvg: SVGSVGElement | null = layerEl.querySelector("svg") as SVGSVGElement | null;
    if (hwSvg) {
      hwSvg.style.position = "relative";
      hwSvg.style.zIndex = "1";
    }

    let gridSvg: SVGSVGElement | null = null;
    if (mountOpts.showGrid) {
      const ns = "http://www.w3.org/2000/svg";
      gridSvg = document.createElementNS(ns, "svg") as SVGSVGElement;
      gridSvg.classList.add("kakitori-grid");
      gridSvg.setAttribute("width", String(size));
      gridSvg.setAttribute("height", String(size));
      gridSvg.setAttribute("aria-hidden", "true");
      gridSvg.style.position = "absolute";
      gridSvg.style.top = "0";
      gridSvg.style.left = "0";
      gridSvg.style.pointerEvents = "none";
      drawCrossGrid(gridSvg, size, mountOpts.showGrid);
      layerEl.insertBefore(gridSvg, layerEl.firstChild);
    }

    const m: MountState = {
      targetEl,
      layerEl,
      hwSvg,
      gridSvg,
      activeOverlay: null,
      pendingEndingJudgment: null,
      quizActive: false,
      strokeEndingMistakes: 0,
      isPointerDown: false,
      lastMoveTime: 0,
      releaseTime: 0,
      timedPoints: [],
      boundOnPointerDown: null,
      boundOnPointerMove: null,
      boundOnPointerUp: null,
      boundOnClick: null,
      options: mountOpts,
      hw,
      size,
      padding,
    };

    if (mountOpts.onClick) {
      m.boundOnClick = (e: MouseEvent) => {
        const strokeIndex = getStrokeIndexAtPoint(e.clientX, e.clientY);
        mountOpts.onClick!({ character: currentCharacter, strokeIndex });
      };
      // Attach to layerEl (Char-owned) instead of targetEl so clicks on
      // unrelated sibling DOM the host placed inside targetEl do not
      // trigger spurious onClick callbacks (with strokeIndex: null).
      m.layerEl.addEventListener("click", m.boundOnClick);
    }

    mounted = m;
    return api;
  }

  function unmount(): Char {
    assertNotDestroyed();
    if (!mounted) {
      return api;
    }
    const m = mounted;
    // Tear down any in-flight quiz/animate so hanzi-writer's listeners and
    // overlay state do not stay alive on the about-to-be-detached SVG.
    // Invalidate any queued start()/animate() that is still waiting on
    // configReady so they cannot resurrect after unmount.
    ++requestSeq;
    cancelActiveAnimation(m);
    cancelActiveQuiz(m);
    mounted = null;
    stopTimingTracking(m);
    if (m.boundOnClick) {
      m.layerEl.removeEventListener("click", m.boundOnClick);
      m.boundOnClick = null;
    }
    // Symmetric with mount(), which only appends layerEl. Removing just
    // layerEl leaves any unrelated DOM the host may already have inside
    // targetEl untouched; gridSvg / activeOverlay are inside layerEl so
    // they're dropped together.
    m.layerEl.remove();
    return api;
  }

  function isMounted(): boolean {
    assertNotDestroyed();
    return mounted !== null;
  }

  // ===== headless config API =====
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
  function setStrokeGroups(next: number[][]): Char {
    assertNotDestroyed();
    strokeGroups = next;
    return api;
  }
  function setStrokeEndings(next: StrokeEnding[]): Char {
    assertNotDestroyed();
    strokeEndings = next;
    return api;
  }

  function getLogicalStrokeCount(): number {
    assertNotDestroyed();
    if (strokeGroups) {
      return strokeGroups.length;
    }
    if (mounted) {
      return getStrokePaths(mounted).length;
    }
    if (judger) {
      return judger.character.strokes.length;
    }
    return 0;
  }

  async function setCharacter(c: string): Promise<Char> {
    assertNotDestroyed();
    currentCharacter = c;
    strokeEndings = null;
    characterData = null;
    if (mounted) {
      mounted.strokeEndingMistakes = 0;
      mounted.pendingEndingJudgment = null;
      await mounted.hw.setCharacter(c);
    }
    if (judger) {
      judger.perStroke = [];
      await judger.hw.setCharacter(c);
      judger.character = (judger.hw as unknown as {
        _character: { strokes: Array<{ getAverageDistance(points: Pt[]): number }> };
      })._character;
    }
    return api;
  }

  // ===== mount-bound public API =====
  function start(): Char {
    const m = assertMounted();
    cancelActiveAnimation(m);
    const seq = ++requestSeq;
    configReady.then(() => {
      if (destroyed || mounted !== m || seq !== requestSeq) {
        return;
      }
      startQuiz(m);
    });
    return api;
  }

  function animate(): Char {
    const m = assertMounted();
    cancelActiveQuiz(m);
    const seq = ++requestSeq;
    configReady.then(() => {
      if (destroyed || mounted !== m || seq !== requestSeq) {
        return;
      }
      startAnimation(m);
    });
    return api;
  }

  function reset(): Char {
    const m = assertMounted();
    ++requestSeq;
    cancelActiveAnimation(m);
    cancelActiveQuiz(m);
    resetStrokeColors();
    return api;
  }

  function hideCharacter(): Char {
    assertMounted().hw.hideCharacter();
    return api;
  }
  function showCharacter(): Char {
    assertMounted().hw.showCharacter();
    return api;
  }
  function showOutline(): Char {
    assertMounted().hw.showOutline();
    return api;
  }
  function hideOutline(): Char {
    assertMounted().hw.hideOutline();
    return api;
  }

  function getStrokeIndexAtPoint(clientX: number, clientY: number): number | null {
    const m = assertMounted();
    const svg = m.hwSvg;
    if (!svg) {
      return null;
    }
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !(el instanceof SVGPathElement)) {
      return null;
    }
    const clipAttr = el.getAttribute("clip-path");
    if (!clipAttr) {
      return null;
    }
    const match = clipAttr.match(/#([^")\s]+)/);
    if (!match) {
      return null;
    }
    const maskId = match[1];

    const clipPaths = svg.querySelectorAll("defs clipPath");
    const strokeCount = getStrokePaths(m).length;
    if (strokeCount === 0) {
      return null;
    }
    for (let i = 0; i < clipPaths.length; i++) {
      if (clipPaths[i].id === maskId) {
        const dataIdx = i % strokeCount;
        return getLogicalStrokeNum(dataIdx);
      }
    }
    return null;
  }

  function setStrokeColor(logicalStrokeNum: number, color: string = "#FF0000"): Char {
    const m = assertMounted();
    const strokePaths = getStrokePaths(m);
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
    return api;
  }

  function resetStrokeColor(logicalStrokeNum: number): Char {
    const m = assertMounted();
    const strokePaths = getStrokePaths(m);
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
    return api;
  }

  function resetStrokeColors(): Char {
    const m = assertMounted();
    const strokePaths = getStrokePaths(m);
    for (const path of strokePaths) {
      if (path.dataset.kakitoriOriginalStroke !== undefined) {
        path.style.stroke = path.dataset.kakitoriOriginalStroke;
        delete path.dataset.kakitoriOriginalStroke;
      }
    }
    return api;
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }
    // Reuse unmount() so destroy() inherits its non-destructive teardown
    // (only the layer Char appended is removed; sibling DOM the host had
    // inside targetEl stays in place). Set `destroyed` after so the
    // `assertNotDestroyed` checks inside unmount-adjacent code paths do
    // not throw.
    if (mounted) {
      unmount();
    }
    destroyed = true;
    if (judger) {
      judger.container.remove();
      judger = null;
    }
    // ensureJudger() re-checks `destroyed` after its polling await and
    // rejects if it flipped during init; the catch in that block already
    // removes the offscreen container. Swallow the rejection here so it
    // does not propagate as unhandled when nobody awaited the in-flight
    // judge() call.
    if (judgerInit) {
      judgerInit.catch(() => {});
      judgerInit = null;
    }
    characterData = null;
  }

  // ===== construction =====
  // Auto-load config from @k1low/kakitori-data unless disabled (null).
  const configLoader = options.configLoader === null
    ? null
    : options.configLoader ?? defaultConfigLoader;
  let configReady: Promise<void>;
  if (configLoader) {
    configReady = Promise.resolve()
      .then(() => configLoader(currentCharacter))
      .then((config) => {
        if (destroyed) {
          return;
        }
        if (!config) {
          return;
        }
        log?.(`config loaded: ${JSON.stringify(config)}`);
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

  const api: Char = {
    ready,
    judge,
    result,
    getStrokeEndings,
    setStrokeEndings,
    getStrokeGroups,
    setStrokeGroups,
    getLogicalStrokeCount,
    setCharacter,
    mount,
    unmount,
    isMounted,
    start,
    animate,
    reset,
    hideCharacter,
    showCharacter,
    showOutline,
    hideOutline,
    setStrokeColor,
    resetStrokeColor,
    resetStrokeColors,
    getStrokeIndexAtPoint,
    destroy,
  };
  return api;
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
   * Create a new Char instance for `character`. Headless by default — call
   * {@link Char.mount} to attach it to a DOM element for interactive
   * practice. {@link Char.judge} works without mounting.
   * @example
   * const c = char.create("永");
   * c.mount("#target", { size: 300 });
   * c.start();
   */
  create: createImpl,
  /**
   * Render a character as a lightweight static SVG without HanziWriter.
   * @example
   * char.render("#target", "永", { size: 60, onClick: ({ character }) => console.log(character) });
   */
  render: renderImpl,
};
