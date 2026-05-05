import { describe, it, expect, vi } from "vitest";
import { attachEndingJudgmentPatch } from "./patchEndingJudgment.js";
import type { StrokeEndingJudgment } from "./types.js";

function failingJudgment(): StrokeEndingJudgment {
  return {
    correct: false,
    expected: ["harai"],
    confidence: 0.4,
    velocityProfile: "constant",
    actualEndDirection: null,
  };
}

function passingJudgment(): StrokeEndingJudgment {
  return {
    correct: true,
    expected: ["tome"],
    confidence: 0.9,
    velocityProfile: "decelerating",
    actualEndDirection: null,
  };
}

interface FakeQuiz {
  _currentStrokeIndex: number;
  _handleSuccess: (meta: any) => void;
  _handleFailure: (meta: any) => void;
  _getStrokeData: (args: any) => any;
  __kakitoriPatched?: boolean;
}

function createFakeQuiz(): {
  quiz: FakeQuiz;
  originalSuccess: ReturnType<typeof vi.fn>;
  originalFailure: ReturnType<typeof vi.fn>;
} {
  const originalSuccess = vi.fn();
  const originalFailure = vi.fn();
  const quiz: FakeQuiz = {
    _currentStrokeIndex: 0,
    _handleSuccess: originalSuccess,
    _handleFailure: originalFailure,
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

describe("attachEndingJudgmentPatch", () => {
  it("marks the quiz as patched and is idempotent", () => {
    const { quiz, originalSuccess } = createFakeQuiz();
    attachEndingJudgmentPatch(quiz, { runJudgment: () => null });
    expect(quiz.__kakitoriPatched).toBe(true);
    const patchedHandleSuccess = quiz._handleSuccess;

    // Second call must be a no-op (does not re-wrap the already-wrapped fn).
    attachEndingJudgmentPatch(quiz, { runJudgment: () => null });
    expect(quiz._handleSuccess).toBe(patchedHandleSuccess);
    void originalSuccess;
  });

  it("calls original _handleSuccess when judgment is null (no config)", () => {
    const { quiz, originalSuccess, originalFailure } = createFakeQuiz();
    const onResolved = vi.fn();
    attachEndingJudgmentPatch(quiz, {
      runJudgment: () => null,
      onResolved,
    });

    quiz._handleSuccess({ isStrokeBackwards: false });
    expect(originalSuccess).toHaveBeenCalledTimes(1);
    expect(originalFailure).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalledWith(null);
  });

  it("calls original _handleSuccess when judgment passes", () => {
    const { quiz, originalSuccess, originalFailure } = createFakeQuiz();
    const judgment = passingJudgment();
    const onMistake = vi.fn();
    const onResolved = vi.fn();
    attachEndingJudgmentPatch(quiz, {
      runJudgment: () => judgment,
      onMistake,
      onResolved,
    });

    quiz._handleSuccess({ isStrokeBackwards: false });
    expect(originalSuccess).toHaveBeenCalledTimes(1);
    expect(originalFailure).not.toHaveBeenCalled();
    expect(onMistake).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalledWith(judgment);
  });

  it("routes to _handleFailure when judgment fails and strokeEndingAsMiss=true", () => {
    const { quiz, originalSuccess, originalFailure } = createFakeQuiz();
    const judgment = failingJudgment();
    const onMistake = vi.fn();
    const onResolved = vi.fn();
    attachEndingJudgmentPatch(quiz, {
      runJudgment: () => judgment,
      onMistake,
      onResolved,
      strokeEndingAsMiss: true,
    });

    quiz._handleSuccess({ isStrokeBackwards: false });
    expect(originalFailure).toHaveBeenCalledTimes(1);
    expect(originalSuccess).not.toHaveBeenCalled();
    expect(onMistake).toHaveBeenCalledTimes(1);
    expect(onMistake.mock.calls[0][0]).toBe(judgment);
    expect(onMistake.mock.calls[0][1].willAdvance).toBe(false);
    // onResolved is NOT fired on the rejection path: the stroke is going
    // back to the user, so no judgment is "resolved".
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("routes to _handleSuccess when judgment fails and strokeEndingAsMiss=false (default)", () => {
    const { quiz, originalSuccess, originalFailure } = createFakeQuiz();
    const judgment = failingJudgment();
    const onMistake = vi.fn();
    const onResolved = vi.fn();
    attachEndingJudgmentPatch(quiz, {
      runJudgment: () => judgment,
      onMistake,
      onResolved,
    });

    quiz._handleSuccess({ isStrokeBackwards: false });
    expect(originalSuccess).toHaveBeenCalledTimes(1);
    expect(originalFailure).not.toHaveBeenCalled();
    expect(onMistake).toHaveBeenCalledTimes(1);
    expect(onMistake.mock.calls[0][1].willAdvance).toBe(true);
    expect(onResolved).toHaveBeenCalledWith(judgment);
  });

  it("passes the current data stroke index to runJudgment and onMistake", () => {
    const { quiz } = createFakeQuiz();
    quiz._currentStrokeIndex = 3;
    const runJudgment = vi.fn(
      (_quiz: any, _dataStrokeNum: number, _meta: any) => failingJudgment(),
    );
    const onMistake = vi.fn();
    attachEndingJudgmentPatch(quiz, {
      runJudgment,
      onMistake,
      strokeEndingAsMiss: false,
    });

    quiz._handleSuccess({ isStrokeBackwards: false });
    expect(runJudgment).toHaveBeenCalledTimes(1);
    expect(runJudgment.mock.calls[0][1]).toBe(3);
    expect(onMistake.mock.calls[0][1].dataStrokeNum).toBe(3);
  });
});
