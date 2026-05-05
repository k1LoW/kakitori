import type { StrokeEndingJudgment } from "./types.js";
import type { CharLogger } from "./charOptions.js";
import type { HanziQuiz, QuizStrokeMeta } from "./hanziWriterInternals.js";

export interface EndingPatchOptions {
  /**
   * Compute ending judgment for the data stroke being accepted. Returning
   * null means "no judgment applies" (the success path runs unchanged).
   */
  runJudgment: (
    quiz: HanziQuiz,
    dataStrokeNum: number,
    meta: QuizStrokeMeta,
  ) => StrokeEndingJudgment | null;
  /**
   * Fired when judgment is non-null and `correct=false`. Caller can fire
   * `onStrokeEndingMistake`, increment counters, etc. The patch itself
   * stays free of caller-specific concerns.
   */
  onMistake?: (
    judgment: StrokeEndingJudgment,
    ctx: {
      quiz: HanziQuiz;
      dataStrokeNum: number;
      willAdvance: boolean;
      meta: QuizStrokeMeta;
    },
  ) => void;
  /**
   * Fired right before the original `_handleSuccess` runs (either because
   * judgment passed or because `strokeEndingAsMiss=false` is letting the
   * stroke through). Caller can stash the judgment for `onCorrectStroke` to
   * pick up.
   */
  onResolved?: (judgment: StrokeEndingJudgment | null) => void;
  /**
   * When true, a failing judgment routes the stroke to `_handleFailure`
   * instead of `_handleSuccess`, forcing the user to redraw it.
   */
  strokeEndingAsMiss?: boolean;
  log?: CharLogger | null;
}

/**
 * Wraps a hanzi-writer quiz instance so its `_handleSuccess` consults
 * `runJudgment` before letting the stroke advance. Idempotent: a second
 * call on the same quiz is a no-op.
 *
 * Pure function: takes a quiz-shaped object plus injected callbacks, so it
 * can be unit-tested with a fake quiz.
 */
export function attachEndingJudgmentPatch(
  quiz: HanziQuiz,
  options: EndingPatchOptions,
): void {
  if (quiz.__kakitoriPatched) {
    return;
  }
  quiz.__kakitoriPatched = true;

  const originalHandleSuccess = quiz._handleSuccess.bind(quiz);
  const originalHandleFailure = quiz._handleFailure.bind(quiz);

  quiz._handleSuccess = (meta: QuizStrokeMeta) => {
    const dataStrokeNum: number = quiz._currentStrokeIndex;
    const judgment = options.runJudgment(quiz, dataStrokeNum, meta);

    if (judgment && !judgment.correct) {
      const willAdvance = !options.strokeEndingAsMiss;
      options.onMistake?.(judgment, { quiz, dataStrokeNum, willAdvance, meta });
      if (options.strokeEndingAsMiss) {
        options.log?.(`stroke ending miss → reject stroke (data=${dataStrokeNum})`);
        originalHandleFailure(meta);
        return;
      }
    }

    options.onResolved?.(judgment);
    originalHandleSuccess(meta);
  };
}
