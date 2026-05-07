import { describe, it, expect } from "vitest";
import { block } from "./block.js";
import type { BlockSpec, FuriganaAnnotation } from "./types.js";

// `validateBlockSpec` is internal; exercise it through `block.create()`,
// which runs every input check before touching the DOM (the parent only
// sees an appendChild after validation passes), so a throw means the
// parent stays empty.
function expectCreateThrows(spec: BlockSpec, message: RegExp): HTMLElement {
  const parent = document.createElement("div");
  expect(() => block.create(parent, { spec })).toThrow(message);
  expect(parent.children.length).toBe(0);
  return parent;
}

describe("block.create input validation", () => {
  describe("cellSize", () => {
    it("rejects zero", () => {
      expectCreateThrows(
        { cells: [{ kind: "free", expected: "あ", mode: "write" }], size: 0 },
        /cellSize must be a finite positive number/,
      );
    });

    it("rejects negative", () => {
      expectCreateThrows(
        { cells: [{ kind: "free", expected: "あ", mode: "write" }], size: -10 },
        /cellSize must be a finite positive number/,
      );
    });

    it("rejects NaN", () => {
      expectCreateThrows(
        { cells: [{ kind: "free", expected: "あ", mode: "write" }], size: NaN },
        /cellSize must be a finite positive number/,
      );
    });

    it("rejects Infinity", () => {
      expectCreateThrows(
        {
          cells: [{ kind: "free", expected: "あ", mode: "write" }],
          size: Number.POSITIVE_INFINITY,
        },
        /cellSize must be a finite positive number/,
      );
    });
  });

  describe("guided cell.char", () => {
    it("rejects empty string", () => {
      expectCreateThrows(
        { cells: [{ kind: "guided", char: "", mode: "show" }] },
        /cells\[0\]\.char must be a non-empty string/,
      );
    });

    it("rejects non-string", () => {
      expectCreateThrows(
        {
          cells: [
            // intentionally bad input from a JS caller
            { kind: "guided", char: 42 as unknown as string, mode: "show" },
          ],
        },
        /cells\[0\]\.char must be a non-empty string/,
      );
    });
  });

  describe("free cell expected", () => {
    it("rejects empty string", () => {
      expectCreateThrows(
        { cells: [{ kind: "free", expected: "", mode: "write" }] },
        /cells\[0\]\.expected must be a non-empty string/,
      );
    });

    it("rejects empty array", () => {
      expectCreateThrows(
        { cells: [{ kind: "free", expected: [], mode: "write" }] },
        /cells\[0\]\.expected must be a non-empty string array/,
      );
    });

    it("rejects array containing empty string", () => {
      expectCreateThrows(
        { cells: [{ kind: "free", expected: ["ok", ""], mode: "write" }] },
        /cells\[0\]\.expected\[1\] must be a non-empty string/,
      );
    });
  });

  describe("free cell span", () => {
    it("rejects span smaller than the longest candidate", () => {
      expectCreateThrows(
        {
          cells: [{ kind: "free", expected: ["がっこう", "学校"], mode: "write", span: 2 }],
        },
        /span \(2\) is smaller than the longest expected candidate length \(4\)/,
      );
    });

    it("rejects non-integer span", () => {
      expectCreateThrows(
        {
          cells: [{ kind: "free", expected: "学", mode: "write", span: 1.5 }],
        },
        /cells\[0\]\.span must be a positive integer/,
      );
    });

    it("rejects NaN span", () => {
      expectCreateThrows(
        {
          cells: [{ kind: "free", expected: "学", mode: "write", span: NaN }],
        },
        /cells\[0\]\.span must be a positive integer/,
      );
    });

    it("rejects zero span", () => {
      expectCreateThrows(
        {
          cells: [{ kind: "free", expected: "学", mode: "write", span: 0 }],
        },
        /cells\[0\]\.span must be a positive integer/,
      );
    });
  });

  describe("writingMode", () => {
    it("rejects unsupported writingMode", () => {
      const parent = document.createElement("div");
      expect(() =>
        block.create(parent, {
          spec: { cells: [{ kind: "guided", char: "学", mode: "show" }] },
          // intentionally bad input
          writingMode: "horizontal-rl" as unknown as "horizontal-tb",
        }),
      ).toThrow(/writingMode must be "vertical-rl" or "horizontal-tb"/);
      expect(parent.children.length).toBe(0);
    });
  });

  describe("annotations", () => {
    const baseCells: BlockSpec["cells"] = [
      { kind: "guided", char: "学", mode: "show" },
      { kind: "guided", char: "校", mode: "show" },
    ];

    it("rejects out-of-range cellRange", () => {
      const annotation: FuriganaAnnotation = {
        cellRange: [0, 5],
        expected: "がっこう",
        mode: "show",
      };
      expectCreateThrows(
        { cells: baseCells, annotations: [annotation] },
        /annotations\[0\]\.cellRange \[0, 5\] is out of range/,
      );
    });

    it("rejects negative sizeRatio", () => {
      const annotation: FuriganaAnnotation = {
        cellRange: [0, 1],
        expected: "がっこう",
        mode: "show",
        sizeRatio: -0.1,
      };
      expectCreateThrows(
        { cells: baseCells, annotations: [annotation] },
        /annotations\[0\]\.sizeRatio must be a finite positive number/,
      );
    });

    it("rejects zero sizeRatio", () => {
      const annotation: FuriganaAnnotation = {
        cellRange: [0, 1],
        expected: "がっこう",
        mode: "show",
        sizeRatio: 0,
      };
      expectCreateThrows(
        { cells: baseCells, annotations: [annotation] },
        /annotations\[0\]\.sizeRatio must be a finite positive number/,
      );
    });

    it("rejects NaN sizeRatio", () => {
      const annotation: FuriganaAnnotation = {
        cellRange: [0, 1],
        expected: "がっこう",
        mode: "show",
        sizeRatio: NaN,
      };
      expectCreateThrows(
        { cells: baseCells, annotations: [annotation] },
        /annotations\[0\]\.sizeRatio must be a finite positive number/,
      );
    });

    it("rejects unsupported placement for vertical-rl", () => {
      const annotation: FuriganaAnnotation = {
        cellRange: [0, 1],
        expected: "がっこう",
        mode: "show",
        placement: "top",
      };
      const parent = document.createElement("div");
      expect(() =>
        block.create(parent, {
          spec: { cells: baseCells, annotations: [annotation] },
          writingMode: "vertical-rl",
        }),
      ).toThrow(/placement="top" is not supported for writingMode="vertical-rl"/);
    });
  });
});
