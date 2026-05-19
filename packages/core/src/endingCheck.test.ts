import { describe, it, expect } from "vitest";
import { computeEndingCheck, type EndingCheckInput } from "./endingCheck.js";
import type { TimedPoint } from "./types.js";

const downStroke: TimedPoint[] = [
  { x: 0, y: 0, t: 0 },
  { x: 0, y: 100, t: 50 },
];

const baseInput: EndingCheckInput = {
  dataStrokeNum: 0,
  points: downStroke,
  strokeEndings: null,
  strokeGroups: null,
  characterData: null,
  drawableSize: 300,
  strictness: 0.7,
};

describe("computeEndingCheck", () => {
  it("returns null when strokeEndings is not configured", () => {
    expect(computeEndingCheck(baseInput)).toBeNull();
  });

  it("returns null when expected.types is empty", () => {
    expect(
      computeEndingCheck({
        ...baseInput,
        strokeEndings: [{ types: [] }],
      }),
    ).toBeNull();
  });

  it("returns null mid-group (only the first stroke of a group triggers check)", () => {
    expect(
      computeEndingCheck({
        ...baseInput,
        dataStrokeNum: 1,
        strokeGroups: [[0, 1]],
        strokeEndings: [{ types: ["tome"] }],
      }),
    ).toBeNull();
  });

  it("runs check on the first stroke of a group", () => {
    const result = computeEndingCheck({
      ...baseInput,
      dataStrokeNum: 0,
      strokeGroups: [[0, 1]],
      strokeEndings: [{ types: ["tome"] }],
    });
    expect(result).not.toBeNull();
    expect(result!.expected).toEqual(["tome"]);
  });

  it("runs check on every stroke when strokeGroups is null (1:1 mapping)", () => {
    const result = computeEndingCheck({
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
    const result = computeEndingCheck({
      ...baseInput,
      strokeEndings: [{ types: ["harai"] }],
      characterData,
    });
    expect(result).not.toBeNull();
    // The check should have run with a derived direction; we don't
    // assert the exact correctness flag (depends on check() heuristics),
    // just that check was applied.
    expect(result!.expected).toEqual(["harai"]);
  });

  it("uses configured direction when provided (no auto-derivation needed)", () => {
    const result = computeEndingCheck({
      ...baseInput,
      strokeEndings: [{ types: ["harai"], direction: [0, -1] }],
    });
    expect(result).not.toBeNull();
  });

  it("returns a check with `correct: false` for an obviously mismatched ending", () => {
    // Drawn points have no timing data → check falls back to "tome", but
    // expected is "harai" → mismatch.
    const result = computeEndingCheck({
      ...baseInput,
      strokeEndings: [{ types: ["harai"], direction: [0, -1] }],
    });
    expect(result?.correct).toBe(false);
  });
});
