import { describe, it, expect } from "vitest";
import { computeBlockSpan, layoutPage } from "./layout.js";
import type { BlockSpec } from "../block/index.js";
import type { PageBlockEntry } from "./types.js";

function guidedBlock(n: number): BlockSpec {
  return {
    cells: Array.from({ length: n }, (_, i) => ({
      kind: "guided" as const,
      char: ["学", "校", "本", "日"][i % 4],
      mode: "show" as const,
    })),
  };
}

function annotatedBlock(n: number): BlockSpec {
  return {
    ...guidedBlock(n),
    annotations: [
      { cellRange: [0, n - 1], expected: "がくこう".slice(0, n), mode: "show" },
    ],
  };
}

function freeBlock(span: number): BlockSpec {
  return {
    cells: [{ kind: "free", expected: "がっこう", mode: "write", span }],
  };
}

function entry(spec: BlockSpec, id?: string): PageBlockEntry {
  return id === undefined ? { spec } : { spec, id };
}

describe("computeBlockSpan", () => {
  it("counts one slot per guided cell", () => {
    expect(computeBlockSpan(guidedBlock(3))).toBe(3);
  });

  it("uses explicit span on free cells", () => {
    expect(computeBlockSpan(freeBlock(4))).toBe(4);
  });

  it("falls back to longest expected length when span is omitted", () => {
    const spec: BlockSpec = {
      cells: [{ kind: "free", expected: ["がっこう", "学校"], mode: "write" }],
    };
    expect(computeBlockSpan(spec)).toBe(4);
  });
});

describe("layoutPage flow", () => {
  it("packs annotation-free blocks into a single column when they fit", () => {
    const result = layoutPage(
      [entry(guidedBlock(2)), entry(guidedBlock(3))],
      { columns: 2, cellsPerColumn: 8 },
    );
    expect(result.segments).toEqual([
      {
        blockIndex: 0,
        segmentIndex: 0,
        segmentCount: 1,
        column: 0,
        cellInColumn: 0,
        cellFrom: 0,
        cellTo: 1,
        span: 2,
      },
      {
        blockIndex: 1,
        segmentIndex: 0,
        segmentCount: 1,
        column: 0,
        cellInColumn: 2,
        cellFrom: 0,
        cellTo: 2,
        span: 3,
      },
    ]);
  });

  it("rolls a fully filled column over to the next", () => {
    const result = layoutPage(
      [entry(guidedBlock(8)), entry(guidedBlock(2))],
      { columns: 3, cellsPerColumn: 8 },
    );
    expect(result.segments[0]).toMatchObject({
      blockIndex: 0,
      column: 0,
      cellInColumn: 0,
      span: 8,
      cellFrom: 0,
      cellTo: 7,
    });
    expect(result.segments[1]).toMatchObject({
      blockIndex: 1,
      column: 1,
      cellInColumn: 0,
      span: 2,
    });
  });
});

describe("layoutPage split (annotation-free)", () => {
  it("splits a block at a column boundary into two segments", () => {
    // Column 0 has 6 cells already used; the next block (span=4, no
    // annotations) splits as 2 + 2 across columns 0 and 1.
    const result = layoutPage(
      [entry(guidedBlock(6)), entry(guidedBlock(4))],
      { columns: 2, cellsPerColumn: 8 },
    );
    expect(result.segments).toEqual([
      {
        blockIndex: 0,
        segmentIndex: 0,
        segmentCount: 1,
        column: 0,
        cellInColumn: 0,
        cellFrom: 0,
        cellTo: 5,
        span: 6,
      },
      {
        blockIndex: 1,
        segmentIndex: 0,
        segmentCount: 2,
        column: 0,
        cellInColumn: 6,
        cellFrom: 0,
        cellTo: 1,
        span: 2,
      },
      {
        blockIndex: 1,
        segmentIndex: 1,
        segmentCount: 2,
        column: 1,
        cellInColumn: 0,
        cellFrom: 2,
        cellTo: 3,
        span: 2,
      },
    ]);
  });
});

describe("layoutPage split (annotated)", () => {
  it("splits an annotated block into segments at column boundaries", () => {
    const result = layoutPage(
      [entry(guidedBlock(6)), entry(annotatedBlock(4))],
      { columns: 2, cellsPerColumn: 8 },
    );
    // Annotated block splits as 2 + 2 across columns 0 and 1.
    expect(result.segments).toEqual([
      {
        blockIndex: 0,
        segmentIndex: 0,
        segmentCount: 1,
        column: 0,
        cellInColumn: 0,
        cellFrom: 0,
        cellTo: 5,
        span: 6,
      },
      {
        blockIndex: 1,
        segmentIndex: 0,
        segmentCount: 2,
        column: 0,
        cellInColumn: 6,
        cellFrom: 0,
        cellTo: 1,
        span: 2,
      },
      {
        blockIndex: 1,
        segmentIndex: 1,
        segmentCount: 2,
        column: 1,
        cellInColumn: 0,
        cellFrom: 2,
        cellTo: 3,
        span: 2,
      },
    ]);
  });
});

describe("layoutPage validation", () => {
  it("throws when running out of columns", () => {
    expect(() =>
      layoutPage(
        [entry(guidedBlock(8)), entry(guidedBlock(8)), entry(guidedBlock(8))],
        { columns: 2, cellsPerColumn: 8 },
      ),
    ).toThrow(/overflow past column=1/);
  });

  it("rejects non-positive columns / cellsPerColumn", () => {
    expect(() => layoutPage([], { columns: 0, cellsPerColumn: 5 })).toThrow(
      /columns must be a positive integer/,
    );
    expect(() => layoutPage([], { columns: 5, cellsPerColumn: 0 })).toThrow(
      /cellsPerColumn must be a positive integer/,
    );
  });

  it("rejects a free cell whose span exceeds cellsPerColumn", () => {
    expect(() =>
      layoutPage([entry(freeBlock(10))], { columns: 2, cellsPerColumn: 8 }),
    ).toThrow(/exceeds cellsPerColumn/);
  });
});
