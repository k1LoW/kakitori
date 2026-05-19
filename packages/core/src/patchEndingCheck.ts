import type { StrokeEndingResult } from "./types.js";
import type { CharLogger } from "./charOptions.js";
import type { HanziQuiz, QuizStrokeMeta } from "./hanziWriterInternals.js";

export interface EndingPatchOptions {
  /**
   * Compute ending check for the data stroke being accepted. Returning
   * null means "no check applies" (the success path runs unchanged).
   */
  runCheck: (
    quiz: HanziQuiz,
    dataStrokeNum: number,
    meta: QuizStrokeMeta,
  ) => StrokeEndingResult | null;
  /**
   * Fired when check is non-null and `correct=false`. Caller can fire
   * `onStrokeEndingMistake`, increment counters, etc. The patch itself
   * stays free of caller-specific concerns.
   */
  onMistake?: (
    check: StrokeEndingResult,
    ctx: {
      quiz: HanziQuiz;
      dataStrokeNum: number;
      willAdvance: boolean;
      meta: QuizStrokeMeta;
    },
  ) => void;
  /**
   * Fired right before the original `_handleSuccess` runs (either because
   * check passed or because `strokeEndingAsMiss=false` is letting the
   * stroke through). Caller can stash the check for `onCorrectStroke` to
   * pick up.
   */
  onResolved?: (check: StrokeEndingResult | null) => void;
  /**
   * When true, a failing check routes the stroke to `_handleFailure`
   * instead of `_handleSuccess`, forcing the user to redraw it.
   */
  strokeEndingAsMiss?: boolean;
  log?: CharLogger | null;
}

/**
 * Wraps a hanzi-writer quiz instance so its `_handleSuccess` consults
 * `runCheck` before letting the stroke advance. Mutates the passed
 * `quiz` (sets `__kakitoriPatched`, replaces `_handleSuccess`).
 * Idempotent: a second call on the same quiz is a no-op.
 *
 * Carries no closure-bound state of its own — every dependency is supplied
 * through `options`, so a fake quiz plus inline callbacks is enough to
 * unit-test the routing.
 */
export function attachEndingCheckPatch(
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
    const check = options.runCheck(quiz, dataStrokeNum, meta);

    if (check && !check.correct) {
      const willAdvance = !options.strokeEndingAsMiss;
      options.onMistake?.(check, { quiz, dataStrokeNum, willAdvance, meta });
      if (options.strokeEndingAsMiss) {
        options.log?.(`stroke ending miss → reject stroke (data=${dataStrokeNum})`);
        originalHandleFailure(meta);
        return;
      }
    }

    options.onResolved?.(check);
    originalHandleSuccess(meta);
  };
}
