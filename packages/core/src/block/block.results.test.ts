import { describe, it, expect } from "vitest";
import { block } from "./block.js";
import type { BlockSpec } from "./types.js";
import type { CharDataLoaderFn } from "../charOptions.js";

const stubLoader: CharDataLoaderFn = (_c, onLoad) => {
  // Single horizontal stroke spanning most of the canvas. Chosen so a
  // horizontal user stroke in display coords (the shape the tests draw
  // with `strokeAt(el, [[10, 40], [70, 40]])`) projects to a stroke
  // with the same direction as the median, so the matcher returns
  // matched=true. Block / page coordination tests need OK verdicts to
  // drive onCellComplete + onBlockComplete + onPageComplete; a
  // diagonal median would land NG and block the new per-char retry
  // path, holding back the very callbacks these tests assert on.
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

function buildBlock(spec: BlockSpec) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const b = block.create(parent, {
    spec,
    cellSize: 80,
    loaders: { charDataLoader: stubLoader, configLoader: null },
  });
  return { parent, b };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve());
}

describe("Block.results", () => {
  it("accepts a block-wide leniency option and mounts each guided cell normally", async () => {
    // `BlockCreateOptions.leniency` plumbing: with a block-wide
    // leniency set, every guided cell should still mount and surface
    // its placeholder snapshot just like a vanilla block. The
    // actual matcher-behaviour shift is hanzi-writer's territory;
    // here we confirm the option flows through `mountGuidedCell`
    // without crashing or shifting the snapshot shape.
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const b = block.create(parent, {
      spec: { cells: [{ kind: "guided", char: "学", mode: "write" }] },
      cellSize: 80,
      leniency: 1.5,
      loaders: { charDataLoader: stubLoader, configLoader: null },
    });
    await flushMicrotasks();
    const snap = b.result();
    expect(snap.cells).toHaveLength(1);
    expect(snap.cells[0].kind).toBe("guided");
    expect(snap.cells[0].chars).toHaveLength(1);
    expect(snap.cells[0].chars[0].character).toBe("学");
    b.destroy();
    parent.remove();
  });

  it("rejects non-finite or non-positive block-wide leniency at block.create", async () => {
    // The validation guard at the block.create entry point proves
    // `opts.leniency` is actually read by block.create — a regression
    // that dropped the option silently would not throw here. Mirrors
    // the codebase's other entry-point validators (cellSize,
    // sizeRatio, annotationStripThickness).
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    expect(() =>
      block.create(parent, {
        spec: { cells: [{ kind: "guided", char: "学", mode: "write" }] },
        cellSize: 80,
        leniency: Number.NaN,
        loaders: { charDataLoader: stubLoader, configLoader: null },
      }),
    ).toThrow(/leniency must be a finite positive number/);
    expect(() =>
      block.create(parent, {
        spec: { cells: [{ kind: "guided", char: "学", mode: "write" }] },
        cellSize: 80,
        leniency: 0,
        loaders: { charDataLoader: stubLoader, configLoader: null },
      }),
    ).toThrow(/leniency must be a finite positive number/);
    parent.remove();
  });

  it("lets a per-cell overrides.leniency mount with no block-wide value set", async () => {
    // Pins the precedence contract: per-cell `overrides.leniency`
    // is the existing path (via `pickCreateOpts` → `CREATE_KEYS`)
    // and must continue to work whether or not the block-wide
    // shortcut is supplied. The two channels share `char.create`'s
    // `leniency` slot, so a misordered spread would either drop the
    // per-cell value or swap precedence; this asserts the mount
    // path stays clean in the "only per-cell set" case.
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const b = block.create(parent, {
      spec: {
        cells: [
          {
            kind: "guided",
            char: "学",
            mode: "write",
            overrides: { leniency: 0.5 },
          },
        ],
      },
      cellSize: 80,
      loaders: { charDataLoader: stubLoader, configLoader: null },
    });
    await flushMicrotasks();
    const snap = b.result();
    expect(snap.cells).toHaveLength(1);
    expect(snap.cells[0].kind).toBe("guided");
    expect(snap.cells[0].chars[0].character).toBe("学");
    b.destroy();
    parent.remove();
  });

  it("returns vacuous-complete snapshot for an all-show block", async () => {
    const { b, parent } = buildBlock({
      cells: [
        { kind: "free", expected: "あ", mode: "show" },
        { kind: "free", expected: "い", mode: "show" },
      ],
    });
    await flushMicrotasks();
    const snap = b.result();
    expect(snap.complete).toBe(true);
    expect(snap.matched).toBe(true);
    expect(snap.cells).toHaveLength(2);
    expect(snap.cells[0].chars).toEqual([
      { character: "あ", complete: true, matched: true, perStroke: [], source: "free", mode: "show" },
    ]);
    expect(snap.cells[1].chars).toEqual([
      { character: "い", complete: true, matched: true, perStroke: [], source: "free", mode: "show" },
    ]);
    expect(snap.annotations).toEqual([]);
    b.destroy();
    parent.remove();
  });

  it("blank cells contribute zero CharResult entries to the snapshot", async () => {
    const { b, parent } = buildBlock({
      cells: [{ kind: "blank", span: 3 }],
    });
    await flushMicrotasks();
    const snap = b.result();
    // `span` propagates through from the spec so block.restore can
    // reproduce the original width for placeholder cells.
    expect(snap.cells[0]).toEqual({ kind: "blank", chars: [], span: 3 });
    // Vacuous true on both rollups since nothing has to be matched.
    expect(snap.complete).toBe(true);
    expect(snap.matched).toBe(true);
    b.destroy();
    parent.remove();
  });

  it("free cell records span = longest expected candidate length when chars.length is shorter", async () => {
    // Free cell with multiple expected candidates: "学校" (length 2) and
    // "がっこう" (length 4). The first candidate drives the placeholder
    // chars.length (2), but the layout reserves 4 slots (longest).
    // BlockCellResult.span must carry that 4 through so
    // block.restore / page.restore can reproduce the original width
    // instead of shrinking to the placeholder's content.
    const { b, parent } = buildBlock({
      cells: [{ kind: "free", expected: ["学校", "がっこう"], mode: "write" }],
    });
    await flushMicrotasks();
    const snap = b.result();
    expect(snap.cells[0].kind).toBe("free");
    expect(snap.cells[0].chars).toHaveLength(2);
    expect(snap.cells[0].span).toBe(4);
    b.destroy();
    parent.remove();
  });

  it("free cell omits span when chars.length already matches the layout", async () => {
    // expected: "がっこう" — single candidate, longest === first === 4.
    // Placeholder chars.length === 4 so no extra width to record;
    // span is omitted to keep the field meaningful rather than
    // redundant for restore consumers.
    const { b, parent } = buildBlock({
      cells: [{ kind: "free", expected: "がっこう", mode: "write" }],
    });
    await flushMicrotasks();
    const snap = b.result();
    expect(snap.cells[0].kind).toBe("free");
    expect(snap.cells[0].chars).toHaveLength(4);
    expect(snap.cells[0].span).toBeUndefined();
    b.destroy();
    parent.remove();
  });

  it("write-mode free cell starts as not complete and reports a placeholder per expected character", async () => {
    const { b, parent } = buildBlock({
      cells: [{ kind: "free", expected: "あい", mode: "write" }],
    });
    await flushMicrotasks();
    const snap = b.result();
    expect(snap.complete).toBe(false);
    // Vacuous matched=true because no character has settled yet.
    expect(snap.matched).toBe(true);
    expect(snap.cells[0].kind).toBe("free");
    expect(snap.cells[0].chars).toHaveLength(2);
    for (const c of snap.cells[0].chars) {
      expect(c.complete).toBe(false);
    }
    b.destroy();
    parent.remove();
  });

  it("buildBlockResult rollup ignores in-progress chars when computing matched", async () => {
    // Mix a settled show cell (matched=true, complete=true) with an
    // in-progress write cell. The block-level matched must stay true
    // because no completed character has failed yet.
    const { b, parent } = buildBlock({
      cells: [
        { kind: "free", expected: "あ", mode: "show" },
        { kind: "free", expected: "い", mode: "write" },
      ],
    });
    await flushMicrotasks();
    const surfaces = parent.querySelectorAll<SVGSVGElement>("svg");
    // surfaces[1] hosts the write-mode cell — draw a stroke that won't
    // commit to a candidate (single horizontal line vs. expected あ).
    strokeAt(surfaces[1] as SVGElement, [[10, 10], [70, 10]], 1);
    const snap = b.result();
    expect(snap.complete).toBe(false);
    expect(snap.matched).toBe(true); // only the show cell is settled
    expect(snap.cells[0].chars[0].complete).toBe(true);
    expect(snap.cells[1].chars[0].complete).toBe(false);
    b.destroy();
    parent.remove();
  });

  it("block-wide per-block: single-cell block commits once the cell is captured", async () => {
    // Per-block injects `correction: "deferred"` into each guided
    // cell. With a single-cell block, the moment that one cell
    // finishes drawing, the coordinator's pending set drains, the
    // coordinator calls check() on the cell, and onCellComplete fires.
    // The visible result is unchanged from before per-block became
    // real-deferred, so this test is the baseline.
    const completedCells: number[] = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const b = block.create(parent, {
      spec: {
        cells: [{ kind: "guided", char: "あ", mode: "write" }],
      },
      cellSize: 80,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      correction: "per-block",
      onCellComplete: (idx) => {
        completedCells.push(idx);
      },
    });
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 50));

    const surfaces = parent.querySelectorAll<SVGSVGElement>("svg");
    strokeAt(surfaces[0] as SVGElement, [[10, 40], [70, 40]], 1);
    await new Promise((r) => setTimeout(r, 200));

    expect(completedCells).toEqual([0]);
    b.destroy();
    parent.remove();
  });

  it("block-wide per-block: multi-cell block holds onCellComplete until EVERY cell is drawn", async () => {
    // The defining behavior of real-deferred per-block: with two
    // cells, drawing only the first one must NOT emit onCellComplete
    // for either cell. Both completes fire in a burst once the second
    // cell finishes drawing too.
    const completedCells: number[] = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const b = block.create(parent, {
      spec: {
        cells: [
          { kind: "guided", char: "あ", mode: "write" },
          { kind: "guided", char: "い", mode: "write" },
        ],
      },
      cellSize: 80,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      correction: "per-block",
      onCellComplete: (idx) => {
        completedCells.push(idx);
      },
    });
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 50));

    // Each guided cell mounts a hanzi-writer <svg>; with `showGrid:
    // true` (the block default), the cell wrapper also contains a
    // sibling grid <svg>. Filter to writer SVGs by looking for the
    // ones that hold hanzi-writer's `<defs>` / inner <g> path
    // structure (grid svgs only have <line> children).
    const allSvgs = Array.from(parent.querySelectorAll<SVGSVGElement>("svg"));
    const writerSvgs = allSvgs.filter(
      (s) => s.querySelector(":scope > defs") !== null,
    );
    // Cell 0 done — block must still be silent.
    strokeAt(writerSvgs[0], [[10, 40], [70, 40]], 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(completedCells).toEqual([]);

    // Cell 1 done — coordinator fires check() on both, both commit.
    strokeAt(writerSvgs[1], [[10, 40], [70, 40]], 2);
    await new Promise((r) => setTimeout(r, 200));
    expect(completedCells.toSorted()).toEqual([0, 1]);
    b.destroy();
    parent.remove();
  });

  it("block-wide per-block: undo of a captured deferred cell re-arms the coordinator", async () => {
    // Coordinator regression: undoing a cell after it captured must
    // put it back into perBlockPending and clear perBlockTriggered,
    // otherwise the next cell's capture drains the set and fires
    // check() on a cell whose char-level captures have already been
    // re-armed by Char.undo() and are gone.
    const completedCells: number[] = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const b = block.create(parent, {
      spec: {
        cells: [
          { kind: "guided", char: "あ", mode: "write" },
          { kind: "guided", char: "い", mode: "write" },
        ],
      },
      cellSize: 80,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      correction: "per-block",
      onCellComplete: (idx) => {
        completedCells.push(idx);
      },
    });
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 50));

    const writerSvgs = Array.from(
      parent.querySelectorAll<SVGSVGElement>("svg"),
    ).filter((s) => s.querySelector(":scope > defs") !== null);

    // Capture cell 0 only.
    strokeAt(writerSvgs[0], [[10, 40], [70, 40]], 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(completedCells).toEqual([]);

    // Undo cell 0 — coordinator must re-add it to pending. If it
    // doesn't, capturing cell 1 below would drain the set early.
    b.undo();
    await new Promise((r) => setTimeout(r, 50));

    // Capture cell 1 — block must STILL be silent because cell 0 is
    // pending again.
    strokeAt(writerSvgs[1], [[10, 40], [70, 40]], 2);
    await new Promise((r) => setTimeout(r, 100));
    expect(completedCells).toEqual([]);

    // Re-capture cell 0 — now both pending, coordinator fires check()
    // on all cells and both commit.
    strokeAt(writerSvgs[0], [[10, 40], [70, 40]], 3);
    await new Promise((r) => setTimeout(r, 200));
    expect(completedCells.toSorted()).toEqual([0, 1]);

    b.destroy();
    parent.remove();
  });

  it("block-wide per-block: mixed guided + free write cells all defer together", async () => {
    // Per-block now defers free write cells too. With one guided cell
    // and one free write cell, drawing only the guided one must not
    // fire any onCellComplete; drawing the free cell after that
    // drains the coordinator and both commit in a burst.
    const completedCells: number[] = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const b = block.create(parent, {
      spec: {
        cells: [
          { kind: "guided", char: "あ", mode: "write" },
          { kind: "free", expected: "い", mode: "write" },
        ],
      },
      cellSize: 80,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      correction: "per-block",
      onCellComplete: (idx) => {
        completedCells.push(idx);
      },
    });
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 50));

    const writerSvgs = Array.from(
      parent.querySelectorAll<SVGSVGElement>("svg"),
    ).filter((s) => s.querySelector(":scope > defs") !== null);

    // Capture the guided cell only — free cell hasn't been touched,
    // so block-level pending still has cell:1. Coordinator must
    // remain silent.
    strokeAt(writerSvgs[0], [[10, 40], [70, 40]], 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(completedCells).toEqual([]);

    // Now drive the free cell. With stubLoader's 1-stroke chars,
    // one stroke settles the い candidate and triggers
    // onCellCaptured for the free cell. The coordinator now drains
    // and runs the burst.
    const allSvgs = Array.from(parent.querySelectorAll<SVGSVGElement>("svg"));
    const freeSvgs = allSvgs.filter(
      (s) => s.querySelector(":scope > defs") === null,
    );
    const freeTarget = freeSvgs[freeSvgs.length - 1] ?? writerSvgs[1];
    strokeAt(freeTarget, [[10, 40], [70, 40]], 2);
    await new Promise((r) => setTimeout(r, 300));

    expect(completedCells.toSorted()).toEqual([0, 1]);
    b.destroy();
    parent.remove();
  });

  it("per-block: NG cell re-arms pending and burst commits only after the OK retry", async () => {
    // The per-block rejection coordination loop:
    //
    // 1. Both cells captured → first burst → cell 0 lands NG, cell 1
    //    lands OK. Cell 1 commits onCellComplete; cell 0 re-arms
    //    (onCharRejected) so block puts it back in perBlockPending
    //    and clears perBlockTriggered.
    // 2. User rewrites cell 0 with a matching stroke → captured
    //    signal drains the pending set again → second burst fires.
    //    Cell 0 commits this time; onBlockComplete fires.
    //
    // Locks in the (a) "rejection re-adds to pending + flips
    // triggered back to false" path and (b) "captured-after-retry
    // fires another burst" path together.
    const completedCells: number[] = [];
    const blockCompletes: number[] = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const b = block.create(parent, {
      spec: {
        cells: [
          { kind: "guided", char: "あ", mode: "write" },
          { kind: "guided", char: "い", mode: "write" },
        ],
      },
      cellSize: 80,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      correction: "per-block",
      onCellComplete: (idx) => completedCells.push(idx),
      onBlockComplete: () => blockCompletes.push(1),
    });
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 50));

    const writerSvgs = Array.from(
      parent.querySelectorAll<SVGSVGElement>("svg"),
    ).filter((s) => s.querySelector(":scope > defs") !== null);

    // Cell 0: NG stroke (diagonal vs horizontal stub median).
    strokeAt(writerSvgs[0], [[10, 10], [70, 70]], 1);
    // Cell 1: OK stroke.
    strokeAt(writerSvgs[1], [[10, 40], [70, 40]], 2);
    await new Promise((r) => setTimeout(r, 200));

    // First burst landed cell 0 NG → only cell 1 should have
    // committed; cell 0 is back in pending and onBlockComplete is
    // held back.
    expect(completedCells).toEqual([1]);
    expect(blockCompletes).toEqual([]);

    // User rewrites cell 0 with a matching stroke; the captured
    // signal drains pending and fires another burst that commits
    // cell 0 + onBlockComplete.
    strokeAt(writerSvgs[0], [[10, 40], [70, 40]], 3);
    await new Promise((r) => setTimeout(r, 200));

    expect(completedCells.toSorted()).toEqual([0, 1]);
    expect(blockCompletes).toEqual([1]);
    b.destroy();
    parent.remove();
  });

  it("per-cell overrides.correction: 'per-stroke' wins over block-wide 'per-block'", async () => {
    // The per-cell override path is the one consumers reach for when
    // they want a mixed block. Verify that an explicit per-cell
    // `per-stroke` still rejects clearly-wrong strokes (no completion)
    // even when the block default is `per-block`.
    const completedCells: number[] = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const b = block.create(parent, {
      spec: {
        cells: [
          {
            kind: "guided",
            char: "あ",
            mode: "write",
            overrides: { correction: "per-stroke" },
          },
        ],
      },
      cellSize: 80,
      loaders: { charDataLoader: stubLoader, configLoader: null },
      correction: "per-block",
      onCellComplete: (idx) => {
        completedCells.push(idx);
      },
    });
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 50));

    const surfaces = parent.querySelectorAll<SVGSVGElement>("svg");
    strokeAt(surfaces[0] as SVGElement, [[10, 40], [70, 40]], 1);
    await new Promise((r) => setTimeout(r, 200));

    expect(completedCells).toEqual([]);
    b.destroy();
    parent.remove();
  });
});
