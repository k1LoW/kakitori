import { describe, it, expect, vi } from "vitest";
import { attachEndingCheckPatch } from "./patchEndingCheck.js";
import type { StrokeEndingResult } from "./types.js";
import type { HanziQuiz, QuizStrokeMeta } from "./hanziWriterInternals.js";

function failingCheck(): StrokeEndingResult {
  return {
    correct: false,
    expected: ["harai"],
    confidence: 0.4,
    velocityProfile: "constant",
    actualEndDirection: null,
  };
}

function passingCheck(): StrokeEndingResult {
  return {
    correct: true,
    expected: ["tome"],
    confidence: 0.9,
    velocityProfile: "decelerating",
    actualEndDirection: null,
  };
}

function createFakeQuiz(): {
  quiz: HanziQuiz;
  originalSuccess: ReturnType<typeof vi.fn>;
  originalFailure: ReturnType<typeof vi.fn>;
} {
  const originalSuccess = vi.fn();
  const originalFailure = vi.fn();
  const quiz: HanziQuiz = {
    _currentStrokeIndex: 0,
    _totalMistakes: 0,
    _handleSuccess: originalSuccess,
    _handleFailure: originalFailure,
    endUserStroke: vi.fn(),
    _getStrokeData: () => ({
      drawnPath: { pathString: "", points: [] },
      isBackwards: false,
      mistakesOnStroke: 0,
      totalMistakes: 0,
      strokesRemaining: 1,
    }),
  };
  return { quiz, originalSuccess, originalFailure };
}

describe("attachEndingCheckPatch", () => {
  it("marks the quiz as patched and is idempotent", () => {
    const { quiz, originalSuccess } = createFakeQuiz();
    attachEndingCheckPatch(quiz, { runCheck: () => null });
    expect(quiz.__kakitoriPatched).toBe(true);
    const patchedHandleSuccess = quiz._handleSuccess;

    // Second call must be a no-op (does not re-wrap the already-wrapped fn).
    attachEndingCheckPatch(quiz, { runCheck: () => null });
    expect(quiz._handleSuccess).toBe(patchedHandleSuccess);
    void originalSuccess;
  });

  it("calls original _handleSuccess when check is null (no config)", () => {
    const { quiz, originalSuccess, originalFailure } = createFakeQuiz();
    const onResolved = vi.fn();
    attachEndingCheckPatch(quiz, {
      runCheck: () => null,
      onResolved,
    });

    quiz._handleSuccess({ isStrokeBackwards: false });
    expect(originalSuccess).toHaveBeenCalledTimes(1);
    expect(originalFailure).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalledWith(null);
  });

  it("calls original _handleSuccess when check passes", () => {
    const { quiz, originalSuccess, originalFailure } = createFakeQuiz();
    const check = passingCheck();
    const onMistake = vi.fn();
    const onResolved = vi.fn();
    attachEndingCheckPatch(quiz, {
      runCheck: () => check,
      onMistake,
      onResolved,
    });

    quiz._handleSuccess({ isStrokeBackwards: false });
    expect(originalSuccess).toHaveBeenCalledTimes(1);
    expect(originalFailure).not.toHaveBeenCalled();
    expect(onMistake).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalledWith(check);
  });

  it("routes to _handleFailure when check fails and strokeEndingAsMiss=true", () => {
    const { quiz, originalSuccess, originalFailure } = createFakeQuiz();
    const check = failingCheck();
    const onMistake = vi.fn();
    const onResolved = vi.fn();
    attachEndingCheckPatch(quiz, {
      runCheck: () => check,
      onMistake,
      onResolved,
      strokeEndingAsMiss: true,
    });

    quiz._handleSuccess({ isStrokeBackwards: false });
    expect(originalFailure).toHaveBeenCalledTimes(1);
    expect(originalSuccess).not.toHaveBeenCalled();
    expect(onMistake).toHaveBeenCalledTimes(1);
    expect(onMistake.mock.calls[0][0]).toBe(check);
    expect(onMistake.mock.calls[0][1].willAdvance).toBe(false);
    // onResolved is NOT fired on the rejection path: the stroke is going
    // back to the user, so no check is "resolved".
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("routes to _handleSuccess when check fails and strokeEndingAsMiss=false (default)", () => {
    const { quiz, originalSuccess, originalFailure } = createFakeQuiz();
    const check = failingCheck();
    const onMistake = vi.fn();
    const onResolved = vi.fn();
    attachEndingCheckPatch(quiz, {
      runCheck: () => check,
      onMistake,
      onResolved,
    });

    quiz._handleSuccess({ isStrokeBackwards: false });
    expect(originalSuccess).toHaveBeenCalledTimes(1);
    expect(originalFailure).not.toHaveBeenCalled();
    expect(onMistake).toHaveBeenCalledTimes(1);
    expect(onMistake.mock.calls[0][1].willAdvance).toBe(true);
    expect(onResolved).toHaveBeenCalledWith(check);
  });

  it("passes the current data stroke index to runCheck and onMistake", () => {
    const { quiz } = createFakeQuiz();
    quiz._currentStrokeIndex = 3;
    const runCheck = vi.fn(
      (_quiz: HanziQuiz, _dataStrokeNum: number, _meta: QuizStrokeMeta) =>
        failingCheck(),
    );
    const onMistake = vi.fn();
    attachEndingCheckPatch(quiz, {
      runCheck,
      onMistake,
      strokeEndingAsMiss: false,
    });

    quiz._handleSuccess({ isStrokeBackwards: false });
    expect(runCheck).toHaveBeenCalledTimes(1);
    expect(runCheck.mock.calls[0][1]).toBe(3);
    expect(onMistake.mock.calls[0][1].dataStrokeNum).toBe(3);
  });
});
