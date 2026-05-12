import { describe, it, expect } from "vitest";
import { block } from "./block.js";
import type { BlockSpec } from "./types.js";
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
    expect(snap.cells[0]).toEqual({ kind: "blank", chars: [] });
    // Vacuous true on both rollups since nothing has to be matched.
    expect(snap.complete).toBe(true);
    expect(snap.matched).toBe(true);
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
});
