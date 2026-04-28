import HanziWriter from "hanzi-writer";
import type { KakitoriOptions, KakitoriLogger } from "./KakitoriOptions.js";
import type {
  StrokeEnding,
  KakitoriStrokeData,
} from "./types.js";
import { judge, type StrokeTimingData } from "./StrokeEndingJudge.js";
import { defaultCharDataLoader } from "./dataLoader.js";

export class Kakitori {
  private hw: HanziWriter;
  private character: string;
  private options: KakitoriOptions;
  private strokeEndings: StrokeEnding[] | null = null;
  private strokeGroups: number[][] | null = null;
  private strokeEndingMistakes = 0;
  private targetEl: HTMLElement;
  private log: KakitoriLogger | null;

  // Maps data stroke index -> logical stroke index (derived from strokeGroups)
  private dataToLogical: Map<number, number> = new Map();
  // Maps data stroke index -> position within its group (0 = first, 1 = second, ...)
  private dataToGroupPos: Map<number, number> = new Map();
  // Maps data stroke index -> group (array of data stroke indices)
  private dataToGroup: Map<number, number[]> = new Map();

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

    if (typeof target === "string") {
      this.targetEl = document.querySelector(target) as HTMLElement;
    } else {
      this.targetEl = target;
    }

    const hwOptions: Record<string, unknown> = {
      width: options.width ?? 300,
      height: options.height ?? 300,
      padding: options.padding ?? 20,
      charDataLoader: options.charDataLoader ?? defaultCharDataLoader,
    };

    if (options.strokeColor != null) hwOptions.strokeColor = options.strokeColor;
    if (options.outlineColor != null) hwOptions.outlineColor = options.outlineColor;
    if (options.drawingColor != null) hwOptions.drawingColor = options.drawingColor;
    if (options.highlightColor != null) hwOptions.highlightColor = options.highlightColor;
    if (options.showOutline != null) hwOptions.showOutline = options.showOutline;
    if (options.showCharacter != null) hwOptions.showCharacter = options.showCharacter;
    if (options.renderer != null) hwOptions.renderer = options.renderer;
    if (options.strokeAnimationSpeed != null) hwOptions.strokeAnimationSpeed = options.strokeAnimationSpeed;
    if (options.delayBetweenStrokes != null) hwOptions.delayBetweenStrokes = options.delayBetweenStrokes;

    this.hw = HanziWriter.create(this.targetEl, character, hwOptions as any);
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

  static create(
    target: string | HTMLElement,
    character: string,
    options: KakitoriOptions = {},
  ): Kakitori {
    return new Kakitori(target, character, options);
  }

  setStrokeGroups(strokeGroups: number[][]): void {
    this.strokeGroups = strokeGroups;
    this.buildGroupMaps();
  }

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

  quiz(): void {
    this.strokeEndingMistakes = 0;
    const strictness = this.options.strokeEndingStrictness ?? 0.7;

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

        // Only apply stroke ending judgment on the last data stroke of a group
        const kakitoriData: KakitoriStrokeData = {
          character: this.character,
          strokeNum: logicalStrokeNum,
          drawnPath: hwData.drawnPath,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: hwData.strokesRemaining - skipsNeeded,
        };

        if (isLast && this.strokeEndings != null) {
          const expected = this.strokeEndings[logicalStrokeNum];
          if (expected) {
            const timing = this.getTimingData();
            this.log?.(`judge input: pause=${timing.pauseBeforeRelease.toFixed(0)}ms timedPoints=${timing.timedPoints.length} hwPoints=${hwData.drawnPath.points.length}`);

            const judgment = judge(
              hwData.drawnPath.points,
              expected,
              strictness,
              timing,
            );
            kakitoriData.strokeEnding = judgment;

            this.log?.(`judge result: stroke=${logicalStrokeNum + 1} detected=${judgment.correct ? expected.type : "other"} expected=${expected.type} correct=${judgment.correct} confidence=${judgment.confidence.toFixed(2)} velocity=${judgment.velocityProfile}`);

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

  animateCharacter(): void {
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

    const speed = this.options.strokeAnimationSpeed ?? 1;
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
    const STROKE_DURATION = 0.8 / speed; // seconds per stroke

    // Calculate delay for each data stroke based on groups.
    // Strokes within the same group get the SAME delay (start simultaneously),
    // just like animCJK does for sub-strokes (e.g. --d:3s for both 3a and 3b).
    const strokeDelays: number[] = new Array(dataStrokes.length).fill(0);
    let currentDelay = 0;
    for (let gi = 0; gi < this.strokeGroups.length; gi++) {
      if (gi > 0) currentDelay += delayBetweenStrokes / 1000;
      const groupDelay = currentDelay;
      for (const dataIdx of this.strokeGroups[gi]) {
        strokeDelays[dataIdx] = groupDelay;
      }
      currentDelay += STROKE_DURATION;
    }
    const totalTime = currentDelay;

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
        --t: ${STROKE_DURATION}s;
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

    this.log?.(`animate: ${dataStrokes.length} strokes, totalTime=${totalTime.toFixed(1)}s`);

    // Wait for animation, then clean up
    await new Promise((r) => setTimeout(r, totalTime * 1000 + 200));
    overlaySvg.remove();
    hwSvg.style.display = "";
  }

  hideCharacter(): void {
    this.hw.hideCharacter();
  }

  showCharacter(): void {
    this.hw.showCharacter();
  }

  showOutline(): void {
    this.hw.showOutline();
  }

  hideOutline(): void {
    this.hw.hideOutline();
  }

  async setCharacter(char: string): Promise<void> {
    this.character = char;
    this.strokeEndings = null;
    this.strokeEndingMistakes = 0;
    await this.hw.setCharacter(char);
  }
}
