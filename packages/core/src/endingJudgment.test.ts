import { describe, it, expect } from "vitest";
import { computeEndingJudgment, type EndingJudgmentInput } from "./endingJudgment.js";

const downStroke: Array<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 0, y: 100 },
];

const baseInput: EndingJudgmentInput = {
  dataStrokeNum: 0,
  drawnPoints: downStroke,
  timing: { pauseBeforeRelease: 0, timedPoints: [] },
  strokeEndings: null,
  strokeGroups: null,
  characterData: null,
  drawableSize: 300,
  strictness: 0.7,
};

describe("computeEndingJudgment", () => {
  it("returns null when strokeEndings is not configured", () => {
    expect(computeEndingJudgment(baseInput)).toBeNull();
  });

  it("returns null when expected.types is empty", () => {
    expect(
      computeEndingJudgment({
        ...baseInput,
        strokeEndings: [{ types: [] }],
      }),
    ).toBeNull();
  });

  it("returns null mid-group (only the first stroke of a group triggers judgment)", () => {
    expect(
      computeEndingJudgment({
        ...baseInput,
        dataStrokeNum: 1,
        strokeGroups: [[0, 1]],
        strokeEndings: [{ types: ["tome"] }],
      }),
    ).toBeNull();
  });

  it("runs judgment on the first stroke of a group", () => {
    const result = computeEndingJudgment({
      ...baseInput,
      dataStrokeNum: 0,
      strokeGroups: [[0, 1]],
      strokeEndings: [{ types: ["tome"] }],
    });
    expect(result).not.toBeNull();
    expect(result!.expected).toEqual(["tome"]);
  });

  it("runs judgment on every stroke when strokeGroups is null (1:1 mapping)", () => {
    const result = computeEndingJudgment({
      ...baseInput,
      dataStrokeNum: 1,
      strokeEndings: [{ types: ["tome"] }, { types: ["tome"] }],
    });
    expect(result).not.toBeNull();
  });

  it("auto-derives direction from characterData for hane/harai when omitted", () => {
    // Median trending up-right → autoDir ≈ [0.71, -0.71] (rounded).
    const characterData = {
      strokes: [
        {
          path: "M 0 0 L 100 -100",
          points: [
            { x: 0, y: 0 },
            { x: 100, y: -100 },
          ],
        },
      ],
    };
    const result = computeEndingJudgment({
      ...baseInput,
      strokeEndings: [{ types: ["harai"] }],
      characterData,
    });
    expect(result).not.toBeNull();
    // The judgment should have run with a derived direction; we don't
    // assert the exact correctness flag (depends on judge() heuristics),
    // just that judgment was applied.
    expect(result!.expected).toEqual(["harai"]);
  });

  it("uses configured direction when provided (no auto-derivation needed)", () => {
    const result = computeEndingJudgment({
      ...baseInput,
      strokeEndings: [{ types: ["harai"], direction: [0, -1] }],
    });
    expect(result).not.toBeNull();
  });

  it("returns a judgment with `correct: false` for an obviously mismatched ending", () => {
    // Drawn points have no timing data → judge falls back to "tome", but
    // expected is "harai" → mismatch.
    const result = computeEndingJudgment({
      ...baseInput,
      strokeEndings: [{ types: ["harai"], direction: [0, -1] }],
    });
    expect(result?.correct).toBe(false);
  });
});
