import HanziWriter from "hanzi-writer";
import type { KakitoriOptions, KakitoriLogger, RenderOptions, GridOptions } from "./KakitoriOptions.js";
import type {
  StrokeEnding,
  KakitoriStrokeData,
} from "./types.js";
import { judge, type StrokeTimingData } from "./StrokeEndingJudge.js";
import { defaultCharDataLoader, defaultConfigLoader } from "./dataLoader.js";
import { DEFAULT_SIZE, DEFAULT_PADDING, HANZI_COORD_SIZE } from "./constants.js";

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

function computeDirectionFromMedian(
  points: Array<{ x: number; y: number }>,
): [number, number] | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) return null;
  return [
    Math.round((dx / mag) * 100) / 100,
    Math.round((dy / mag) * 100) / 100,
  ];
}

export class Kakitori {
  private hw: HanziWriter;
  private character: string;
  private options: KakitoriOptions;
  private strokeEndings: StrokeEnding[] | null = null;
  private strokeGroups: number[][] | null = null;
  private characterData: any = null;
  private configReady: Promise<void>;
  private strokeEndingMistakes = 0;
  private targetEl: HTMLElement;
  private log: KakitoriLogger | null;

  // Maps data stroke index -> logical stroke index (derived from strokeGroups)
  private dataToLogical: Map<number, number> = new Map();
  // Maps data stroke index -> position within its group (0 = first, 1 = second, ...)
  private dataToGroupPos: Map<number, number> = new Map();
  // Maps data stroke index -> group (array of data stroke indices)
  private dataToGroup: Map<number, number[]> = new Map();

  // onClick listener
  private boundOnClick: ((e: MouseEvent) => void) | null = null;

  // Pointer timing tracking
  private isPointerDown = false;
  private lastMoveTime = 0;
  private releaseTime = 0;
  private timedPoints: Array<{ x: number; y: number; t: number }> = [];
  private boundOnPointerDown: ((e: PointerEvent) => void) | null = null;
  private boundOnPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundOnPointerUp: ((e: PointerEvent) => void) | null = null;

  private constructor(
    target: string | HTMLElement,
    character: string,
    options: KakitoriOptions = {},
  ) {
    this.character = character;
    this.options = options;
    this.log = options.logger ?? null;
    this.strokeGroups = options.strokeGroups ?? null;
    this.buildGroupMaps();

    // Auto-load config from @k1low/kakitori-data unless disabled (null)
    const loader = options.configLoader === null
      ? null
      : options.configLoader ?? defaultConfigLoader;
    if (loader) {
      this.configReady = Promise.resolve()
        .then(() => loader(character))
        .then((config) => {
          if (!config) return;
          this.log?.(`config loaded: ${JSON.stringify(config)}`);
          // Preserve any stroke groups already set on the instance
          if (this.strokeGroups == null && config.strokeGroups) {
            this.strokeGroups = config.strokeGroups;
            this.buildGroupMaps();
          }
          if (!this.strokeEndings && config.strokeEndings) {
            this.strokeEndings = config.strokeEndings ?? null;
          }
        })
        .catch((error) => {
          this.log?.(
            `config load failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    } else {
      this.configReady = Promise.resolve();
    }

    if (typeof target === "string") {
      this.targetEl = document.querySelector(target) as HTMLElement;
    } else {
      this.targetEl = target;
    }

    const size = options.size ?? DEFAULT_SIZE;
    const padding = options.padding ?? DEFAULT_PADDING;
    validateSizeAndPadding(size, padding, "Kakitori.create()");
    const hwOptions: Record<string, unknown> = {
      width: size,
      height: size,
      padding,
      charDataLoader: options.charDataLoader ?? defaultCharDataLoader,
    };

    if (options.strokeColor != null) hwOptions.strokeColor = options.strokeColor;
    if (options.outlineColor != null) hwOptions.outlineColor = options.outlineColor;
    if (options.drawingColor != null) hwOptions.drawingColor = options.drawingColor;
    if (options.drawingWidth != null) hwOptions.drawingWidth = options.drawingWidth;
    if (options.highlightColor != null) hwOptions.highlightColor = options.highlightColor;
    if (options.showOutline != null) hwOptions.showOutline = options.showOutline;
    if (options.showCharacter != null) hwOptions.showCharacter = options.showCharacter;
    if (options.strokeAnimationSpeed != null) hwOptions.strokeAnimationSpeed = options.strokeAnimationSpeed;
    if (options.delayBetweenStrokes != null) hwOptions.delayBetweenStrokes = options.delayBetweenStrokes;

    this.hw = HanziWriter.create(this.targetEl, character, hwOptions as any);

    if (options.showGrid) {
      const hwSvg = this.targetEl.querySelector("svg");
      if (hwSvg) {
        drawCrossGrid(hwSvg as SVGSVGElement, size, options.showGrid);
      }
    }

    if (options.onClick) {
      this.boundOnClick = (e: MouseEvent) => {
        const strokeIndex = this.getStrokeIndexAtPoint(e.clientX, e.clientY);
        options.onClick!({ character: this.character, strokeIndex });
      };
      this.targetEl.addEventListener("click", this.boundOnClick);
    }
  }

  private buildGroupMaps(): void {
    this.dataToLogical.clear();
    this.dataToGroupPos.clear();
    this.dataToGroup.clear();
    if (!this.strokeGroups) return;

    for (let logical = 0; logical < this.strokeGroups.length; logical++) {
      const group = this.strokeGroups[logical];
      for (let pos = 0; pos < group.length; pos++) {
        this.dataToLogical.set(group[pos], logical);
        this.dataToGroupPos.set(group[pos], pos);
        this.dataToGroup.set(group[pos], group);
      }
    }
  }

  private isFirstInGroup(dataStrokeNum: number): boolean {
    return this.dataToGroupPos.get(dataStrokeNum) === 0;
  }

  private isLastInGroup(dataStrokeNum: number): boolean {
    const group = this.dataToGroup.get(dataStrokeNum);
    if (!group) return true;
    return this.dataToGroupPos.get(dataStrokeNum) === group.length - 1;
  }

  private getLogicalStrokeNum(dataStrokeNum: number): number {
    return this.dataToLogical.get(dataStrokeNum) ?? dataStrokeNum;
  }

  private getRemainingSkipsInGroup(dataStrokeNum: number): number {
    const group = this.dataToGroup.get(dataStrokeNum);
    if (!group) return 0;
    const pos = this.dataToGroupPos.get(dataStrokeNum) ?? 0;
    return group.length - 1 - pos;
  }

  /**
   * Create a new Kakitori instance with full HanziWriter integration.
   * @example
   * const k = Kakitori.create('#target', 'あ', { size: 300 });
   * k.start();
   */
  static create(
    target: string | HTMLElement,
    character: string,
    options: KakitoriOptions = {},
  ): Kakitori {
    return new Kakitori(target, character, options);
  }

  /**
   * Render a character as a lightweight static SVG without HanziWriter.
   * @example
   * Kakitori.render('#target', 'あ', { size: 60, onClick: ({ character }) => console.log(character) });
   */
  static render(
    target: string | HTMLElement,
    character: string,
    options: RenderOptions = {},
  ): void {
    const el = typeof target === "string"
      ? document.querySelector(target)
      : target;
    if (!el) {
      throw new Error(`Kakitori.render(): target selector "${target}" did not match any element.`);
    }
    const size = options.size ?? DEFAULT_SIZE;
    const padding = options.padding ?? DEFAULT_PADDING;
    validateSizeAndPadding(size, padding, "Kakitori.render()");
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

        if (options.showGrid) {
          drawCrossGrid(svg, size, options.showGrid);
        }

        el.appendChild(svg);

        if (options.onClick) {
          svg.style.cursor = "pointer";
          svg.addEventListener("click", () => {
            options.onClick!({ character });
          });
        }
      },
      (err) => { console.error(`Kakitori.render(): failed to load "${character}"`, err); },
    );
  }

  /** Wait for the async config (strokeGroups, strokeEndings) to finish loading. */
  ready(): Promise<void> {
    return this.configReady;
  }

  /** Return the stroke endings loaded from config, or null if not loaded. */
  getStrokeEndings(): readonly StrokeEnding[] | null {
    return this.strokeEndings;
  }

  /** Return the stroke groups loaded from config, or null if not loaded. */
  getStrokeGroups(): readonly number[][] | null {
    return this.strokeGroups;
  }

  /** Override stroke groups. Rebuilds internal group maps. */
  setStrokeGroups(strokeGroups: number[][]): void {
    this.strokeGroups = strokeGroups;
    this.buildGroupMaps();
  }

  /** Override stroke endings. */
  setStrokeEndings(strokeEndings: StrokeEnding[]): void {
    this.strokeEndings = strokeEndings;
  }

  private startTimingTracking(): void {
    this.stopTimingTracking();

    this.boundOnPointerDown = (e: PointerEvent) => {
      this.isPointerDown = true;
      this.timedPoints = [];
      this.lastMoveTime = performance.now();
      this.releaseTime = 0;
      this.log?.(`pointerdown  x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}`);
    };
    this.boundOnPointerMove = (e: PointerEvent) => {
      if (!this.isPointerDown) return;
      const now = performance.now();
      const dt = (now - this.lastMoveTime).toFixed(0);
      this.lastMoveTime = now;
      this.timedPoints.push({ x: e.clientX, y: e.clientY, t: now });
      this.log?.(`pointermove  x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}  dt=${dt}ms`);
    };
    this.boundOnPointerUp = (e: PointerEvent) => {
      if (!this.isPointerDown) return;
      this.isPointerDown = false;
      this.releaseTime = performance.now();
      const pause = (this.releaseTime - this.lastMoveTime).toFixed(0);
      this.log?.(`pointerup    x=${e.clientX.toFixed(0)} y=${e.clientY.toFixed(0)}  pause=${pause}ms`);
    };

    this.targetEl.addEventListener("pointerdown", this.boundOnPointerDown);
    this.targetEl.addEventListener("pointermove", this.boundOnPointerMove);
    this.targetEl.addEventListener("pointerup", this.boundOnPointerUp);
  }

  private stopTimingTracking(): void {
    if (this.boundOnPointerDown) {
      this.targetEl.removeEventListener("pointerdown", this.boundOnPointerDown);
      this.boundOnPointerDown = null;
    }
    if (this.boundOnPointerMove) {
      this.targetEl.removeEventListener("pointermove", this.boundOnPointerMove);
      this.boundOnPointerMove = null;
    }
    if (this.boundOnPointerUp) {
      this.targetEl.removeEventListener("pointerup", this.boundOnPointerUp);
      this.boundOnPointerUp = null;
    }
  }

  private getTimingData(): StrokeTimingData {
    const pauseBeforeRelease =
      this.releaseTime > 0 && this.lastMoveTime > 0
        ? this.releaseTime - this.lastMoveTime
        : 0;
    return {
      pauseBeforeRelease,
      timedPoints: [...this.timedPoints],
    };
  }

  /** Start writing practice with stroke order and stroke ending (tome/hane/harai) judgment. */
  start(): void {
    this.configReady.then(() => this.startQuiz());
  }

  private startQuiz(): void {
    this.strokeEndingMistakes = 0;
    const strictness = this.options.strokeEndingStrictness ?? 0.7;

    // Pre-load character data for direction auto-computation
    this.hw.getCharacterData().then((c) => { this.characterData = c; });

    this.startTimingTracking();

    this.hw.quiz({
      leniency: this.options.leniency,
      showHintAfterMisses: this.options.showHintAfterMisses,
      highlightOnComplete: this.options.highlightOnComplete,

      onCorrectStroke: (hwData) => {
        const dataStrokeNum = hwData.strokeNum;
        const logicalStrokeNum = this.getLogicalStrokeNum(dataStrokeNum);
        const isLast = this.isLastInGroup(dataStrokeNum);
        const skipsNeeded = this.getRemainingSkipsInGroup(dataStrokeNum);

        this.log?.(`stroke correct: data=${dataStrokeNum} logical=${logicalStrokeNum} isLast=${isLast} skips=${skipsNeeded}`);

        // Skip remaining strokes in the group
        if (skipsNeeded > 0) {
          this.log?.(`auto-skipping ${skipsNeeded} stroke(s) in group`);
          for (let i = 0; i < skipsNeeded; i++) {
            this.hw.skipQuizStroke();
          }
        }

        const kakitoriData: KakitoriStrokeData = {
          character: this.character,
          strokeNum: logicalStrokeNum,
          drawnPath: hwData.drawnPath,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: hwData.strokesRemaining - skipsNeeded,
        };

        // Apply stroke ending judgment on the first data stroke of a group
        // (the one the user actually drew; subsequent strokes are auto-skipped)
        if (this.isFirstInGroup(dataStrokeNum) && this.strokeEndings != null) {
          const expected = this.strokeEndings[logicalStrokeNum];
          // Skip judgment if types is empty or omitted ({})
          if (expected?.types && expected.types.length > 0) {
            // Auto-compute direction from median data if not specified
            let resolvedExpected = expected;
            const needsDirection = expected.types.includes("hane") || expected.types.includes("harai");
            if (expected.direction == null && needsDirection) {
              const group = this.strokeGroups
                ? this.strokeGroups[logicalStrokeNum]
                : [dataStrokeNum];
              const lastDataIdx = group[group.length - 1];
              const medianPoints = this.characterData?.strokes[lastDataIdx]?.points;
              const autoDir = medianPoints ? computeDirectionFromMedian(medianPoints) : null;
              if (autoDir) {
                resolvedExpected = { ...expected, direction: autoDir };
                this.log?.(`auto direction: stroke=${logicalStrokeNum + 1} dir=[${autoDir}]`);
              }
            }

            const timing = this.getTimingData();
            this.log?.(`judge input: pause=${timing.pauseBeforeRelease.toFixed(0)}ms timedPoints=${timing.timedPoints.length} hwPoints=${hwData.drawnPath.points.length}`);

            const judgment = judge(
              hwData.drawnPath.points,
              resolvedExpected,
              {
                drawableSize: (this.options.size ?? DEFAULT_SIZE) - 2 * (this.options.padding ?? DEFAULT_PADDING),
                strictness,
                timing,
              },
            );
            kakitoriData.strokeEnding = judgment;

            this.log?.(`judge result: stroke=${logicalStrokeNum + 1} detected=${judgment.correct ? expected.types : "other"} expected=${expected.types} correct=${judgment.correct} confidence=${judgment.confidence.toFixed(2)} velocity=${judgment.velocityProfile}`);

            if (!judgment.correct) {
              this.strokeEndingMistakes++;
              this.options.onStrokeEndingMistake?.(kakitoriData);
            }
          }
        }

        // Only fire callback on the first stroke of a group (the one the user actually drew)
        if (this.isFirstInGroup(dataStrokeNum) || !this.strokeGroups) {
          this.options.onCorrectStroke?.(kakitoriData);
        }
      },

      onMistake: (hwData) => {
        const logicalStrokeNum = this.getLogicalStrokeNum(hwData.strokeNum);
        const kakitoriData: KakitoriStrokeData = {
          character: this.character,
          strokeNum: logicalStrokeNum,
          drawnPath: hwData.drawnPath,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: hwData.strokesRemaining,
        };
        this.log?.(`mistake: data=${hwData.strokeNum} logical=${logicalStrokeNum}`);
        this.options.onMistake?.(kakitoriData);
      },

      onComplete: (summary) => {
        this.stopTimingTracking();
        this.log?.(`complete: totalMistakes=${summary.totalMistakes} strokeEndingMistakes=${this.strokeEndingMistakes}`);
        this.options.onComplete?.({
          character: summary.character,
          totalMistakes: summary.totalMistakes,
          strokeEndingMistakes: this.strokeEndingMistakes,
        });
      },
    });
  }

  /** Play stroke-order animation. Uses animCJK-style overlay when strokeGroups are configured. */
  animate(): void {
    this.configReady.then(() => this.startAnimation());
  }

  private startAnimation(): void {
    if (!this.strokeGroups) {
      this.hw.animateCharacter();
      return;
    }
    this.animateWithGroups();
  }

  /**
   * Animate using an animCJK-style SVG overlay.
   * Creates a temporary SVG on top of HanziWriter's SVG,
   * hides HanziWriter's character, plays CSS stroke-dash animation,
   * then shows HanziWriter's character and removes the overlay.
   */
  private async animateWithGroups(): Promise<void> {
    if (!this.strokeGroups) return;

    const rawSpeed = this.options.strokeAnimationSpeed ?? 1;
    const speed = Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 1;
    if (speed !== rawSpeed) {
      this.log?.(`strokeAnimationSpeed must be a positive finite number, got ${rawSpeed}; falling back to 1`);
    }
    const delayBetweenStrokes = this.options.delayBetweenStrokes ?? 1000;
    const strokeColor = this.options.strokeColor ?? "#555";
    const outlineColor = this.options.outlineColor ?? "#DDD";

    const character = await this.hw.getCharacterData();
    const dataStrokes = character.strokes;

    const hwSvg = this.targetEl.querySelector("svg");
    if (!hwSvg) return;

    const width = hwSvg.getAttribute("width") || "300";
    const height = hwSvg.getAttribute("height") || "300";

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
    const strokeDelays: number[] = new Array(dataStrokes.length).fill(0);
    let currentDelay = 0;
    for (let gi = 0; gi < this.strokeGroups.length; gi++) {
      if (gi > 0) currentDelay += delayBetweenStrokes / 1000;
      const groupDelay = currentDelay;
      let groupMaxDuration = 0;
      for (const dataIdx of this.strokeGroups[gi]) {
        if (dataIdx < 0 || dataIdx >= dataStrokes.length) continue;
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
      if (end > totalTime) totalTime = end;
    }

    // Build overlay SVG (exact animCJK structure)
    const ns = "http://www.w3.org/2000/svg";
    const overlaySvg = document.createElementNS(ns, "svg");
    overlaySvg.classList.add("kakitori-anim");
    overlaySvg.setAttribute("width", width);
    overlaySvg.setAttribute("height", height);

    // Copy HanziWriter's exact coordinate transform (includes padding, scale, and Y-flip)
    const hwGroup = hwSvg.querySelector(":scope > g");
    const hwTransform = hwGroup?.getAttribute("transform") || "";

    const flipGroup = document.createElementNS(ns, "g");
    flipGroup.setAttribute("transform", hwTransform);

    // CSS style (embedded like animCJK)
    const styleEl = document.createElementNS(ns, "style");
    styleEl.textContent = `
      @keyframes kakitori-zk {
        to { stroke-dashoffset: 0; }
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

    // Hide HanziWriter's SVG, show overlay
    hwSvg.style.display = "none";
    this.targetEl.appendChild(overlaySvg);

    this.log?.(`animate: ${this.strokeGroups!.length} strokes (${dataStrokes.length} data strokes), totalTime=${totalTime.toFixed(1)}s`);

    // Wait for animation, then clean up
    await new Promise((r) => setTimeout(r, totalTime * 1000 + 200));
    overlaySvg.remove();
    hwSvg.style.display = "";
  }

  /** Hide the character strokes. */
  hideCharacter(): void {
    this.hw.hideCharacter();
  }

  /** Show the character strokes. */
  showCharacter(): void {
    this.hw.showCharacter();
  }

  /** Show the character outline (light gray background). */
  showOutline(): void {
    this.hw.showOutline();
  }

  /** Hide the character outline. */
  hideOutline(): void {
    this.hw.hideOutline();
  }

  /**
   * Get the main stroke path elements from HanziWriter's SVG.
   * HanziWriter has 3 groups with clip-path paths: outline, main, highlight.
   * We want the "main" group (second one) for coloring.
   * Returns paths in data stroke order.
   */
  private getStrokePaths(): SVGPathElement[] {
    const svg = this.targetEl.querySelector("svg");
    if (!svg) return [];
    const allGroups = svg.querySelectorAll(":scope > g > g");
    const groupsWithPaths: Element[] = [];
    for (const g of allGroups) {
      if (g.querySelectorAll("path[clip-path]").length > 0) {
        groupsWithPaths.push(g);
      }
    }
    // Main character group is the second group (index 1): outline=0, main=1, highlight=2
    const mainGroup = groupsWithPaths[1];
    if (!mainGroup) return [];
    return Array.from(mainGroup.querySelectorAll("path[clip-path]")) as SVGPathElement[];
  }

  /**
   * Get the logical stroke index at a given point (client coordinates).
   * Uses document.elementFromPoint for accurate hit detection that respects
   * clip-paths and actual rendered output.
   * Returns null if no stroke found at the point.
   */
  getStrokeIndexAtPoint(clientX: number, clientY: number): number | null {
    const svg = this.targetEl.querySelector("svg");
    if (!svg) return null;

    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !(el instanceof SVGPathElement)) return null;

    // The clicked element could be from any group (outline, main, highlight).
    // All groups have the same stroke order. Find which clip-path it uses,
    // then determine the data stroke index from the clip-path id.
    const clipAttr = el.getAttribute("clip-path");
    if (!clipAttr) return null;

    // Extract mask id: url("...#mask-25") -> mask-25
    const match = clipAttr.match(/#([^")\s]+)/);
    if (!match) return null;
    const maskId = match[1];

    // Find all clip-paths in defs and determine the stroke index
    const clipPaths = svg.querySelectorAll("defs clipPath");
    const strokeCount = this.getStrokePaths().length;
    for (let i = 0; i < clipPaths.length; i++) {
      if (clipPaths[i].id === maskId) {
        // clip-paths repeat for each group (outline, main, highlight),
        // so mod by stroke count to get the data stroke index
        const dataIdx = i % strokeCount;
        return this.getLogicalStrokeNum(dataIdx);
      }
    }

    return null;
  }

  /**
   * Set the color of a logical stroke.
   * Use {@link resetStrokeColor} or {@link resetStrokeColors} to restore.
   */
  setStrokeColor(logicalStrokeNum: number, color: string = "#FF0000"): void {
    const strokePaths = this.getStrokePaths();
    const dataIndices = this.strokeGroups
      ? this.strokeGroups[logicalStrokeNum] ?? []
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

  /** Reset a single logical stroke's color to its original value. */
  resetStrokeColor(logicalStrokeNum: number): void {
    const strokePaths = this.getStrokePaths();
    const dataIndices = this.strokeGroups
      ? this.strokeGroups[logicalStrokeNum] ?? []
      : [logicalStrokeNum];

    for (const dataIdx of dataIndices) {
      const path = strokePaths[dataIdx];
      if (path && path.dataset.kakitoriOriginalStroke !== undefined) {
        path.style.stroke = path.dataset.kakitoriOriginalStroke;
        delete path.dataset.kakitoriOriginalStroke;
      }
    }
  }

  /** Reset all stroke colors to their original values. */
  resetStrokeColors(): void {
    const strokePaths = this.getStrokePaths();
    for (const path of strokePaths) {
      if (path.dataset.kakitoriOriginalStroke !== undefined) {
        path.style.stroke = path.dataset.kakitoriOriginalStroke;
        delete path.dataset.kakitoriOriginalStroke;
      }
    }
  }

  /**
   * Get the total number of logical strokes.
   */
  getLogicalStrokeCount(): number {
    if (this.strokeGroups) return this.strokeGroups.length;
    return this.getStrokePaths().length;
  }

  /** Change the displayed character. Resets stroke endings and mistake count. */
  async setCharacter(char: string): Promise<void> {
    this.character = char;
    this.strokeEndings = null;
    this.strokeEndingMistakes = 0;
    await this.hw.setCharacter(char);
  }

  /** Clean up event listeners (click, pointer tracking). Call before discarding the instance. */
  destroy(): void {
    this.stopTimingTracking();
    if (this.boundOnClick) {
      this.targetEl.removeEventListener("click", this.boundOnClick);
      this.boundOnClick = null;
    }
  }
}
