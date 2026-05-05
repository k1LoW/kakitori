import { describe, it, expect, beforeEach, afterEach } from "vitest";
import HanziWriter from "hanzi-writer";

// HanziWriter contract tests: char.ts monkey-patches hanzi-writer's internal
// `_quiz` instance to inject stroke ending judgment between the success
// detection and the stroke-advance step. These tests pin the surface we
// depend on so that an upstream rename or signature change fails here first
// (with a clear "this is the hanzi-writer assumption that broke" message)
// rather than silently breaking the patch.

const mockCharData = {
  strokes: [
    "M 0 0 L 100 100",
    "M 200 200 L 300 300",
  ],
  medians: [
    [[0, 0], [100, 100]],
    [[200, 200], [300, 300]],
  ],
};

const mockCharDataLoader = (
  _char: string,
  onLoad: (data: { strokes: string[]; medians: number[][][] }) => void,
) => {
  onLoad(mockCharData);
};

const fakeUserStroke = {
  points: [
    { x: 0, y: 0 },
    { x: 50, y: 50 },
  ],
  externalPoints: [
    { x: 0, y: 0 },
    { x: 50, y: 50 },
  ],
};

async function createWithQuiz(container: HTMLElement): Promise<any> {
  const hw = HanziWriter.create(container, "あ", {
    width: 300,
    height: 300,
    padding: 0,
    charDataLoader: mockCharDataLoader as any,
  });
  hw.quiz({});
  await expect
    .poll(() => Boolean((hw as any)._quiz), { timeout: 1000 })
    .toBe(true);
  return (hw as any)._quiz;
}

describe("hanzi-writer _quiz contract", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("exposes the private fields and methods char.ts depends on", async () => {
    const quiz = await createWithQuiz(container);

    // Members read by char.ts:
    expect(typeof quiz._handleSuccess).toBe("function");
    expect(typeof quiz._handleFailure).toBe("function");
    expect(typeof quiz._getStrokeData).toBe("function");
    expect(typeof quiz._currentStrokeIndex).toBe("number");
    expect(typeof quiz._totalMistakes).toBe("number");
  });

  it("_handleSuccess advances _currentStrokeIndex", async () => {
    const quiz = await createWithQuiz(container);
    quiz._userStroke = fakeUserStroke;
    const before = quiz._currentStrokeIndex;
    const beforeMistakes = quiz._totalMistakes;

    quiz._handleSuccess({ isStrokeBackwards: false });

    expect(quiz._currentStrokeIndex).toBe(before + 1);
    expect(quiz._totalMistakes).toBe(beforeMistakes);
  });

  it("_handleFailure does NOT advance _currentStrokeIndex and increments _totalMistakes", async () => {
    const quiz = await createWithQuiz(container);
    quiz._userStroke = fakeUserStroke;
    const before = quiz._currentStrokeIndex;
    const beforeMistakes = quiz._totalMistakes;

    quiz._handleFailure({ isStrokeBackwards: false });

    expect(quiz._currentStrokeIndex).toBe(before);
    expect(quiz._totalMistakes).toBeGreaterThan(beforeMistakes);
  });

  it("_getStrokeData returns drawnPath / mistake counters / strokesRemaining", async () => {
    const quiz = await createWithQuiz(container);
    quiz._userStroke = fakeUserStroke;

    const data = quiz._getStrokeData({ isCorrect: true, meta: { isStrokeBackwards: false } });

    expect(data.drawnPath).toBeDefined();
    expect(Array.isArray(data.drawnPath.points)).toBe(true);
    expect(typeof data.drawnPath.pathString).toBe("string");
    expect(typeof data.isBackwards).toBe("boolean");
    expect(typeof data.mistakesOnStroke).toBe("number");
    expect(typeof data.totalMistakes).toBe("number");
    expect(typeof data.strokesRemaining).toBe("number");
  });
});
