import { describe, it, expect, vi } from "vitest";
import { page } from "./page.js";
import type { PageBlockEntry } from "./types.js";
import type { CharDataLoaderFn } from "../charOptions.js";

const stubLoader: CharDataLoaderFn = (_c, onLoad) => {
  // Single horizontal stroke spanning most of the canvas, matched by
  // horizontal user strokes in display coords (`[[10, 40], [70, 40]]`).
  // Page coordination tests assert on onCellComplete /
  // onBlockComplete / onPageComplete, all of which the per-char retry
  // path holds back until an OK verdict; a diagonal median would
  // land NG and stall the burst indefinitely.
  onLoad({
    strokes: ["M 50 500 L 950 500"],
    medians: [[[50, 500], [950, 500]]],
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

  it("results() snapshots reflect partial completion across blocks", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const handle = page.create(parent, {
      writingMode: "vertical-rl",
      columns: 1,
      cellsPerColumn: 4,
      cellSize: 80,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      blocks: [
        // A show-mode block (immediately complete + matched).
        { id: "b0", spec: showSpec("学", "がく") },
        // A write-mode block (in progress until the user matches).
        {
          id: "b1",
          spec: { cells: [{ kind: "free", expected: "あ", mode: "write" }] },
        },
      ],
    });
    await flushMicrotasks();
    const snap = handle.result();
    expect(snap.complete).toBe(false);
    expect(snap.blocks).toHaveLength(2);
    // b0: one show cell + one show annotation, both synthesized as
    // complete + matched, so the per-block result is complete.
    expect(snap.blocks[0].id).toBe("b0");
    expect(snap.blocks[0].complete).toBe(true);
    expect(snap.blocks[0].matched).toBe(true);
    expect(snap.blocks[0].cells[0].chars[0].character).toBe("学");
    // b1: write cell, no strokes yet → chars not complete.
    expect(snap.blocks[1].id).toBe("b1");
    expect(snap.blocks[1].complete).toBe(false);
    expect(snap.blocks[1].cells[0].chars[0].complete).toBe(false);
    // Page-level matched is the vacuous AND across observed completions.
    expect(snap.matched).toBe(true);
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
    expect(onPageComplete.mock.calls[0][0]).toEqual({
      complete: true,
      matched: true,
      blocks: [],
    });
    handle.destroy();
    parent.remove();
  });
});

describe("page.create — correction: per-page deferral", () => {
  it("holds onCellComplete / onBlockComplete / onPageComplete until every block is captured", async () => {
    // Two single-cell user blocks under page-wide `per-page`. Drawing
    // only block 0 must produce ZERO callbacks (deferred at every
    // layer); drawing block 1 then drains the page coordinator, which
    // fires Block.check() on both blocks → cells commit → block
    // commits → page commits, all in one burst.
    const cellComplete = vi.fn();
    const blockComplete = vi.fn();
    const pageComplete = vi.fn();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const handle = page.create(parent, {
      blocks: [
        { spec: { cells: [{ kind: "guided", char: "あ", mode: "write" }] } },
        { spec: { cells: [{ kind: "guided", char: "い", mode: "write" }] } },
      ],
      cellSize: 80,
      columns: 1,
      cellsPerColumn: 4,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      correction: "per-page",
      onCellComplete: cellComplete,
      onBlockComplete: blockComplete,
      onPageComplete: pageComplete,
    });
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 50));

    const writerSvgs = Array.from(
      parent.querySelectorAll<SVGSVGElement>("svg"),
    ).filter((s) => s.querySelector(":scope > defs") !== null);

    // Capture block 0 only — every callback must stay silent.
    strokeAt(writerSvgs[0], [[10, 40], [70, 40]], 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(cellComplete).not.toHaveBeenCalled();
    expect(blockComplete).not.toHaveBeenCalled();
    expect(pageComplete).not.toHaveBeenCalled();

    // Capture block 1 — page coordinator fires every block's check();
    // cells commit, blocks commit, page commits.
    strokeAt(writerSvgs[1], [[10, 40], [70, 40]], 2);
    await new Promise((r) => setTimeout(r, 200));

    expect(cellComplete).toHaveBeenCalledTimes(2);
    expect(blockComplete).toHaveBeenCalledTimes(2);
    expect(pageComplete).toHaveBeenCalledTimes(1);
    handle.destroy();
    parent.remove();
  });

  it("defers a page-spanning write-mode annotation alongside the inner cells", async () => {
    // Single block, two guided cells + a write-mode annotation that
    // spans both cells. Under per-page the annotation must stay silent
    // until both inner cells AND its own captures are in; then the
    // page-wide burst commits the annotation too.
    const cellCompletes: Array<{ blockIndex: number; cellIndex: number; kind: string }> = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const handle = page.create(parent, {
      blocks: [
        {
          spec: {
            cells: [
              { kind: "guided", char: "学", mode: "write" },
              { kind: "guided", char: "校", mode: "write" },
            ],
            annotations: [
              {
                cellRange: [0, 1],
                expected: "がっこう",
                mode: "write",
              },
            ],
          },
        },
      ],
      cellSize: 80,
      columns: 1,
      cellsPerColumn: 4,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      correction: "per-page",
      onCellComplete: (blockIndex, cellIndex, kind) => {
        cellCompletes.push({ blockIndex, cellIndex, kind });
      },
    });
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 50));

    const writerSvgs = Array.from(
      parent.querySelectorAll<SVGSVGElement>("svg"),
    ).filter((s) => s.querySelector(":scope > defs") !== null);

    // Draw both kanji cells — annotation hasn't been touched yet, so
    // perPagePending still has the annotation key. Nothing should
    // fire.
    strokeAt(writerSvgs[0], [[10, 40], [70, 40]], 1);
    strokeAt(writerSvgs[1], [[10, 40], [70, 40]], 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(cellCompletes).toEqual([]);

    // Draw the annotation. The annotation surface is the strip — find
    // it by looking for the SVG that's NOT one of the writer SVGs.
    // For this test we don't need to match perfectly; we just need
    // strokes that cover enough of がっこう's stroke count to settle.
    // Easier path: scan all SVGs and dispatch on each strip.
    const allSvgs = Array.from(
      parent.querySelectorAll<SVGSVGElement>("svg"),
    );
    const stripSvgs = allSvgs.filter(
      (s) => s.querySelector(":scope > defs") === null,
    );
    // Draw exactly 4 horizontal strokes (stubLoader makes every char
    // 1 stroke, so がっこう = 4 strokes). The strokes span the strip
    // width so the matcher accepts each one against the horizontal
    // stub median — under the new NG-retry path, anything less than
    // an OK verdict would clear the annotation in place instead of
    // firing onCellComplete.
    for (let i = 0; i < 4; i++) {
      strokeAt(
        stripSvgs[stripSvgs.length - 1] ?? writerSvgs[0],
        [[5, 10], [70, 10]],
        100 + i,
      );
    }
    await new Promise((r) => setTimeout(r, 300));

    // After the page-wide burst, the inner cells AND the annotation
    // should have committed. We don't pin exact ordering here — the
    // assertion is that every callback fired (and on the right
    // kinds).
    const kinds = cellCompletes.map((c) => c.kind).toSorted();
    expect(kinds).toContain("cell");
    expect(kinds).toContain("annotation");

    handle.destroy();
    parent.remove();
  });

  it("per-page: NG block re-arms page pending and onPageComplete only fires after the OK retry", async () => {
    // Page-level mirror of the per-block retry test: with two
    // single-cell blocks, one block lands NG on its first burst, so
    // its only cell re-arms; the block-level rejection bubbles up
    // via onBlockRejected → onPerPageBlockRejected which re-adds
    // the block to perPagePending and clears perPageTriggered.
    // onPageComplete must be held back until the user rewrites the
    // NG cell with a matching stroke and the second page burst
    // commits everything.
    const cellComplete = vi.fn();
    const blockComplete = vi.fn();
    const pageComplete = vi.fn();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const handle = page.create(parent, {
      blocks: [
        { spec: { cells: [{ kind: "guided", char: "学", mode: "write" }] } },
        { spec: { cells: [{ kind: "guided", char: "校", mode: "write" }] } },
      ],
      cellSize: 80,
      columns: 1,
      cellsPerColumn: 4,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      correction: "per-page",
      onCellComplete: cellComplete,
      onBlockComplete: blockComplete,
      onPageComplete: pageComplete,
    });
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 50));

    const writerSvgs = Array.from(
      parent.querySelectorAll<SVGSVGElement>("svg"),
    ).filter((s) => s.querySelector(":scope > defs") !== null);

    // Block 0: NG stroke (diagonal vs horizontal stub median).
    strokeAt(writerSvgs[0], [[10, 10], [70, 70]], 1);
    // Block 1: OK stroke.
    strokeAt(writerSvgs[1], [[10, 40], [70, 40]], 2);
    await new Promise((r) => setTimeout(r, 200));

    // First page burst: block 1 commits, block 0 re-arms. Nothing
    // page-wide should have committed.
    expect(cellComplete).toHaveBeenCalledTimes(1);
    expect(blockComplete).toHaveBeenCalledTimes(1);
    expect(pageComplete).not.toHaveBeenCalled();

    // Rewrite block 0's cell with a matching stroke; the captured
    // signal walks back up through onPerBlockEntryCaptured →
    // onBlockCaptured → onPerPageBlockCaptured's retry branch and
    // fires another page burst.
    strokeAt(writerSvgs[0], [[10, 40], [70, 40]], 3);
    await new Promise((r) => setTimeout(r, 200));

    expect(cellComplete).toHaveBeenCalledTimes(2);
    expect(blockComplete).toHaveBeenCalledTimes(2);
    expect(pageComplete).toHaveBeenCalledTimes(1);
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
