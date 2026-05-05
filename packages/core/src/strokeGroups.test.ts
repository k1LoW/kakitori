import { describe, it, expect } from "vitest";
import {
  findDataStroke,
  getLogicalStrokeNum,
  getRemainingSkipsInGroup,
  isFirstInGroup,
  isLastInGroup,
  logicalStrokesRemaining,
} from "./strokeGroups.js";

describe("strokeGroups", () => {
  describe("findDataStroke", () => {
    it("returns null when strokeGroups is null", () => {
      expect(findDataStroke(null, 0)).toBeNull();
    });

    it("locates a stroke at the start of a group", () => {
      expect(findDataStroke([[0, 1], [2]], 0)).toEqual({
        logical: 0,
        pos: 0,
        group: [0, 1],
      });
    });

    it("locates a stroke in the middle of a group", () => {
      expect(findDataStroke([[0, 1, 2]], 1)).toEqual({
        logical: 0,
        pos: 1,
        group: [0, 1, 2],
      });
    });

    it("returns null for unmapped data strokes", () => {
      expect(findDataStroke([[0]], 1)).toBeNull();
    });
  });

  describe("getLogicalStrokeNum", () => {
    it("returns the data stroke index when strokeGroups is null", () => {
      expect(getLogicalStrokeNum(null, 5)).toBe(5);
    });

    it("returns the logical index for mapped strokes", () => {
      expect(getLogicalStrokeNum([[0], [1, 2], [3]], 2)).toBe(1);
    });

    it("falls back to data index for unmapped strokes", () => {
      expect(getLogicalStrokeNum([[0]], 1)).toBe(1);
    });
  });

  describe("isFirstInGroup", () => {
    it("returns true for the first stroke of a group", () => {
      expect(isFirstInGroup([[0, 1], [2]], 0)).toBe(true);
      expect(isFirstInGroup([[0, 1], [2]], 2)).toBe(true);
    });

    it("returns false for non-first strokes", () => {
      expect(isFirstInGroup([[0, 1]], 1)).toBe(false);
    });

    it("returns false for unmapped strokes", () => {
      expect(isFirstInGroup([[0]], 1)).toBe(false);
    });
  });

  describe("isLastInGroup", () => {
    it("returns true for the last stroke of a group", () => {
      expect(isLastInGroup([[0, 1]], 1)).toBe(true);
    });

    it("returns false for non-last strokes", () => {
      expect(isLastInGroup([[0, 1]], 0)).toBe(false);
    });

    it("returns true for unmapped strokes (1:1 fallback)", () => {
      expect(isLastInGroup(null, 0)).toBe(true);
      expect(isLastInGroup([[0]], 1)).toBe(true);
    });
  });

  describe("getRemainingSkipsInGroup", () => {
    it("returns 0 when stroke is last in group", () => {
      expect(getRemainingSkipsInGroup([[0, 1]], 1)).toBe(0);
    });

    it("returns the count of strokes after the current one in the group", () => {
      expect(getRemainingSkipsInGroup([[0, 1, 2]], 0)).toBe(2);
      expect(getRemainingSkipsInGroup([[0, 1, 2]], 1)).toBe(1);
    });

    it("returns 0 for unmapped strokes", () => {
      expect(getRemainingSkipsInGroup(null, 0)).toBe(0);
      expect(getRemainingSkipsInGroup([[0]], 1)).toBe(0);
    });
  });

  describe("logicalStrokesRemaining", () => {
    it("returns hwStrokesRemaining when strokeGroups is null", () => {
      expect(logicalStrokesRemaining(null, 0, 5, true)).toBe(5);
      expect(logicalStrokesRemaining(null, 0, 5, false)).toBe(5);
    });

    it("falls back to hwStrokesRemaining when stroke is unmapped (incomplete groups)", () => {
      // strokeGroups=[[0]] means data stroke 1 is unmapped. Without the
      // fallback the formula `groups.length - logical - (correct ? 1 : 0)`
      // would underflow.
      expect(logicalStrokesRemaining([[0]], 1, 1, false)).toBe(1);
    });

    it("excludes the current stroke when isCorrect=true", () => {
      // 3 logical strokes total, currently on logical 1 → 1 remaining after this one.
      expect(logicalStrokesRemaining([[0], [1, 2], [3]], 2, 0, true)).toBe(1);
    });

    it("includes the current stroke when isCorrect=false", () => {
      // Same setup, but on a mistake we count the current stroke as still pending.
      expect(logicalStrokesRemaining([[0], [1, 2], [3]], 2, 0, false)).toBe(2);
    });

    it("yields the same count for any data stroke within the same logical group", () => {
      // Groups collapsed: drawing data stroke 0 or data stroke 1 both put us
      // on logical stroke 0; the remaining count must agree.
      const groups = [[0, 1], [2, 3]];
      expect(logicalStrokesRemaining(groups, 0, 0, true)).toBe(
        logicalStrokesRemaining(groups, 1, 0, true),
      );
    });

    it("matches expectations across multiple groups", () => {
      // 2 logical strokes spanning 4 data strokes. Drawing data 0 (first of
      // group [0, 1]) → 1 logical remaining. Mistake on data 2 (first of
      // group [2, 3]) → 1 logical remaining (current included).
      const groups = [[0, 1], [2, 3]];
      expect(logicalStrokesRemaining(groups, 0, 0, true)).toBe(1);
      expect(logicalStrokesRemaining(groups, 2, 0, false)).toBe(1);
    });
  });
});
