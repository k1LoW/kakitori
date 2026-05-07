import { describe, it, expect, vi } from "vitest";
import { page } from "./page.js";
import type { PageBlockEntry } from "./types.js";
import type { CharDataLoaderFn } from "../charOptions.js";

const stubLoader: CharDataLoaderFn = (_c, onLoad) => {
  onLoad({
    strokes: ["M 0 0 L 100 100"],
    medians: [[[0, 0], [100, 100]]],
  });
};

function strokeAt(
  el: SVGElement,
  points: Array<[number, number]>,
  pointerId = 1,
): void {
  const rect = el.getBoundingClientRect();
  const dispatch = (type: string, x: number, y: number) => {
    const evt = new (globalThis as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent(
      type,
      {
        bubbles: true,
        cancelable: true,
        pointerId,
        clientX: rect.left + x,
        clientY: rect.top + y,
      },
    );
    el.dispatchEvent(evt);
  };
  dispatch("pointerdown", points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    dispatch("pointermove", points[i][0], points[i][1]);
  }
  dispatch("pointerup", points[points.length - 1][0], points[points.length - 1][1]);
}

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
    //         draws its own grid SVG.
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

  it("aligns annotation overlays by slot offset, not cell index", async () => {
    // Regression: annotationSurfaces used localOffset = cell -
    // seg.cellFrom, which wrongly assumed every earlier cell consumed 1
    // slot. With a span=2 free cell sitting before annotated guided
    // cells, the overlays slipped to slot 1 / 2 instead of 2 / 3.
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const cellSize = 80;
    const handle = page.create(parent, {
      writingMode: "vertical-rl",
      columns: 1,
      cellsPerColumn: 6,
      cellSize,
      blocks: [
        {
          spec: {
            cells: [
              { kind: "free", expected: "あい", mode: "show", span: 2 },
              { kind: "free", expected: "学", mode: "show", span: 1 },
              { kind: "free", expected: "校", mode: "show", span: 1 },
            ],
            annotations: [
              { cellRange: [1, 2], expected: "がっこう", mode: "show" },
            ],
          },
        },
      ],
    });
    await flushMicrotasks();
    // Annotation overlay strips are appended after the per-segment
    // slotEl; pick out the cellSize-tall overlays (vertical-rl).
    const annotationOverlays = Array.from(
      handle.el.querySelectorAll<HTMLDivElement>(":scope > div"),
    ).filter(
      (el) =>
        parseInt(el.style.height, 10) === cellSize &&
        el.style.left !== "" &&
        parseInt(el.style.left, 10) > 0,
    );
    // Two annotated cells; tops should be at slot 2 and slot 3, not 1
    // and 2.
    const tops = annotationOverlays.map((el) => parseInt(el.style.top, 10)).toSorted((a, b) => a - b);
    expect(tops).toEqual([2 * cellSize, 3 * cellSize]);
    handle.destroy();
    parent.remove();
  });

  it("places horizontal-tb sub-blocks at the wrapper top, not double-offset by the strip", async () => {
    // Regression: segmentOrigin used to add annotationStripThickness in
    // horizontal-tb, which combined with block.create's own
    // annotationThickness offset shifted cells down by 2 strip
    // thicknesses. Verify the per-block slotEl `top` matches the
    // wrapper top of its row (column index × lineThickness).
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const cellSize = 80;
    const handle = page.create(parent, {
      writingMode: "horizontal-tb",
      columns: 2,
      cellsPerColumn: 3,
      cellSize,
      blocks: [{ spec: showSpec("学校", "がっこう") }],
      annotationStripThickness: 32,
    });
    await flushMicrotasks();
    const lineThickness = cellSize + 32;
    const slotEls = handle.el.querySelectorAll<HTMLDivElement>(":scope > div");
    // First child is the sub-block slotEl for the only block (placed in
    // row 0). Its absolute `top` should equal the wrapper top of row 0
    // (=0), not row 0 + stripThickness.
    expect(slotEls[0].style.top).toBe("0px");
    // Annotation strip surface must align with the row's strip area
    // (top of the wrapper).
    const annotationSurfaces = Array.from(slotEls).filter(
      (el) => el.style.height === `32px`,
    );
    for (const s of annotationSurfaces) {
      expect(parseInt(s.style.top, 10) % lineThickness).toBe(0);
    }
    handle.destroy();
    parent.remove();
  });

  it("undo() walks back across blocks in LRU-on-touch order", async () => {
    // Two blocks, each with a single write-mode free cell. Touch
    // block 0, then block 1, then block 0 again. Repeated undo should
    // revert most-recent-first: block 0 (latest touch), then block 1,
    // then block 0 (initial touch — still in stack via LRU).
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const handle = page.create(parent, {
      writingMode: "vertical-rl",
      columns: 1,
      cellsPerColumn: 4,
      cellSize: 80,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      blocks: [
        { id: "b0", spec: { cells: [{ kind: "free", expected: "あ", mode: "write" }] } },
        { id: "b1", spec: { cells: [{ kind: "free", expected: "い", mode: "write" }] } },
      ],
    });
    await flushMicrotasks();
    const surfaces = handle.el.querySelectorAll<SVGSVGElement>("svg");
    expect(surfaces.length).toBeGreaterThanOrEqual(2);
    // surfaces[0] is the freeCell of block 0 (first placed at top of
    // column). surfaces[1] is block 1's freeCell.
    const s0 = surfaces[0] as SVGElement;
    const s1 = surfaces[1] as SVGElement;
    strokeAt(s0, [[10, 10], [70, 70]], 1);
    strokeAt(s1, [[10, 10], [70, 70]], 2);
    strokeAt(s0, [[20, 20], [60, 60]], 3);
    // freeCell draws one polyline per buffered stroke on the surface
    // SVG, so the polyline count is the per-surface stroke buffer
    // size — observable proof that strokes landed where expected.
    const polyCount = (el: SVGElement) =>
      el.querySelectorAll("polyline").length;
    expect(polyCount(s0)).toBe(2); // initial + re-touch
    expect(polyCount(s1)).toBe(1);

    // First undo reverts block 0 (most recent touch). Block 0's stack
    // had a single entry (re-touch deduped), so this clears both
    // strokes on s0.
    handle.undo();
    expect(polyCount(s0)).toBe(0);
    expect(polyCount(s1)).toBe(1);

    // Second undo reverts block 1.
    handle.undo();
    expect(polyCount(s0)).toBe(0);
    expect(polyCount(s1)).toBe(0);

    // Third undo: nothing left — both surfaces stay empty.
    handle.undo();
    expect(polyCount(s0)).toBe(0);
    expect(polyCount(s1)).toBe(0);
    handle.undo(); // safe no-op
    handle.destroy();
    parent.remove();
  });

  it("undo() clears cellResults so block/page completion can re-fire", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onPageComplete = vi.fn();
    const handle = page.create(parent, {
      writingMode: "vertical-rl",
      columns: 1,
      cellsPerColumn: 4,
      cellSize: 80,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      blocks: [
        {
          spec: {
            cells: [
              { kind: "free", expected: "あ", mode: "show" },
              { kind: "free", expected: "い", mode: "write" },
            ],
          },
        },
      ],
      onPageComplete,
    });
    await flushMicrotasks();
    // The page commits the show cell synchronously but the write cell
    // stays open until the user matches. Touch the write cell (no
    // match expected with the stub stroke), then undo. After undo:
    // (a) the surface SVG is cleared (no polylines), proving the
    //     freeCell handle was reset, and
    // (b) reset() still works without throwing, proving the page-level
    //     done flag isn't stuck.
    const surfaces = handle.el.querySelectorAll<SVGSVGElement>("svg");
    const writeSurface = surfaces[surfaces.length - 1] as SVGElement;
    strokeAt(writeSurface, [[10, 10], [70, 70]], 1);
    expect(writeSurface.querySelectorAll("polyline").length).toBe(1);
    handle.undo();
    expect(writeSurface.querySelectorAll("polyline").length).toBe(0);
    expect(() => handle.reset()).not.toThrow();
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
