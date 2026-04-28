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
  private strokeEndingMistakes = 0;
  private targetEl: HTMLElement;
  private log: KakitoriLogger | null;

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

  static create(
    target: string | HTMLElement,
    character: string,
    options: KakitoriOptions = {},
  ): Kakitori {
    return new Kakitori(target, character, options);
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
        const kakitoriData: KakitoriStrokeData = {
          character: this.character,
          strokeNum: hwData.strokeNum,
          drawnPath: hwData.drawnPath,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: hwData.strokesRemaining,
        };

        if (this.strokeEndings != null) {
          const expected = this.strokeEndings[hwData.strokeNum];
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

            this.log?.(`judge result: stroke=${hwData.strokeNum + 1} detected=${judgment.correct ? expected.type : "other"} expected=${expected.type} correct=${judgment.correct} confidence=${judgment.confidence.toFixed(2)} velocity=${judgment.velocityProfile}`);

            if (!judgment.correct) {
              this.strokeEndingMistakes++;
              this.options.onStrokeEndingMistake?.(kakitoriData);
            }
          }
        }

        this.options.onCorrectStroke?.(kakitoriData);
      },

      onMistake: (hwData) => {
        const kakitoriData: KakitoriStrokeData = {
          character: this.character,
          strokeNum: hwData.strokeNum,
          drawnPath: hwData.drawnPath,
          isBackwards: hwData.isBackwards,
          mistakesOnStroke: hwData.mistakesOnStroke,
          totalMistakes: hwData.totalMistakes,
          strokesRemaining: hwData.strokesRemaining,
        };
        this.log?.(`mistake: stroke=${hwData.strokeNum + 1}`);
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
    this.hw.animateCharacter();
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
