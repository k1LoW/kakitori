import { describe, it, expect, vi } from "vitest";
import { page } from "./page.js";
import type { PageBlockEntry } from "./types.js";

// Free-cell show mode short-circuits hanzi-writer entirely (renderShowText
// paints SVG text and synthesizes a matched result), so we can mount the
// page in happy-dom without touching the network. Guided cells, even in
// show mode, would still trigger char.create which fetches char data.
function showSpec(chars: string, furigana?: string): PageBlockEntry["spec"] {
  return {
    cells: Array.from(chars).map((c) => ({
      kind: "free" as const,
      expected: c,
      mode: "show" as const,
      span: 1,
    })),
    ...(furigana
      ? {
          annotations: [
            {
              cellRange: [0, chars.length - 1] as [number, number],
              expected: furigana,
              mode: "show" as const,
            },
          ],
        }
      : {}),
  };
}

describe("page.create — mount layout", () => {
  it("places one slot per segment and one strip per annotation cell", async () => {
    // Two blocks: 学校 + がっこう (col 0 cells 0-1, fits) and 春夏秋冬 +
    // はるなつあきふゆ (4 cells, splits as 1 + 3 across columns).
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const handle = page.create(parent, {
      columns: 2,
      cellsPerColumn: 3,
      cellSize: 80,
      blocks: [
        { spec: showSpec("学校", "がっこう") },
        { spec: showSpec("春夏秋冬", "はるなつあきふゆ") },
      ],
    });
    // Layout: 学校 spans col 0 cells 0-1 (1 segment) -> 1 slot + 2 strips
    //         春夏秋冬 splits col 0 cell 2 + col 1 cells 0-2 (2 segments)
    //         -> 2 slots + 4 strips. Together they cover the whole 2×3
    //         grid, so no padding blocks are generated. Page no longer
    //         draws its own grid SVG (every visible cell is rendered by a
    //         block — see placePaddingBlocks).
    const svgGrids = handle.el.querySelectorAll(":scope > svg").length;
    const placedDivs = handle.el.querySelectorAll(":scope > div").length;
    expect(svgGrids).toBe(0);
    expect(placedDivs).toBe(3 + 6);
    handle.destroy();
    parent.remove();
  });

  it("emits onCellComplete / onBlockComplete / onPageComplete in order", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const cellCalls: Array<[number, number, string]> = [];
    const blockCalls: number[] = [];
    const pageCalls: boolean[] = [];
    const handle = page.create(parent, {
      columns: 1,
      cellsPerColumn: 4,
      cellSize: 80,
      blocks: [{ spec: showSpec("学校", "がっこう") }],
      onCellComplete: (b, c, kind) => cellCalls.push([b, c, kind]),
      onBlockComplete: (b) => blockCalls.push(b),
      onPageComplete: (r) => pageCalls.push(r.matched),
    });
    await flushMicrotasks();
    // Two cells (show) + one annotation (show). Sequence: 2 cells, 1
    // annotation, then block, then page.
    expect(cellCalls).toEqual([
      [0, 0, "cell"],
      [0, 1, "cell"],
      [0, 0, "annotation"],
    ]);
    expect(blockCalls).toEqual([0]);
    expect(pageCalls).toEqual([true]);
    handle.destroy();
    parent.remove();
  });

  it("re-emits show-mode results on reset()", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onPageComplete = vi.fn();
    const handle = page.create(parent, {
      columns: 1,
      cellsPerColumn: 4,
      cellSize: 80,
      blocks: [{ spec: showSpec("学校", "がっこう") }],
      onPageComplete,
    });
    await flushMicrotasks();
    expect(onPageComplete).toHaveBeenCalledTimes(1);
    handle.reset();
    await flushMicrotasks();
    expect(onPageComplete).toHaveBeenCalledTimes(2);
    expect(onPageComplete.mock.calls[1][0].matched).toBe(true);
    handle.destroy();
    parent.remove();
  });

  it("fires onPageComplete for an empty page", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onPageComplete = vi.fn();
    const handle = page.create(parent, {
      columns: 1,
      cellsPerColumn: 4,
      cellSize: 80,
      blocks: [],
      onPageComplete,
    });
    await flushMicrotasks();
    expect(onPageComplete).toHaveBeenCalledTimes(1);
    expect(onPageComplete.mock.calls[0][0]).toEqual({ matched: true, perBlock: [] });
    handle.destroy();
    parent.remove();
  });
});

function flushMicrotasks(): Promise<void> {
  // Two awaits to let the chained `queueMicrotask`s + the surrounding
  // promise resolutions land before assertions.
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve());
}
