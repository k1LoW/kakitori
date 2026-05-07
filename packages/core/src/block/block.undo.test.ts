import { describe, it, expect } from "vitest";
import { block } from "./block.js";
import type { BlockSpec } from "./types.js";
import type { CharDataLoaderFn } from "../charOptions.js";

// Stop free-cell candidate loading from going to the network; the
// stroke buffer is what matters for these undo-stack assertions.
const stubLoader: CharDataLoaderFn = (_c, onLoad) => {
  onLoad({
    strokes: ["M 0 0 L 100 100"],
    medians: [[[0, 0], [100, 100]]],
  });
};

// happy-dom doesn't expose a real pointer-capture path, but the
// freeCell's pointerdown/move/up handlers are attached directly to the
// surface SVG and the spy hooks (onStroke, onCellComplete) only need
// the buffered stroke array to grow. We synthesize the same pointer
// sequence the browser would dispatch, keyed by pointerId so capture
// state stays consistent.
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
  const [first, ...rest] = points;
  dispatch("pointerdown", first[0], first[1]);
  for (const [x, y] of rest) {
    dispatch("pointermove", x, y);
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

describe("Block.undo", () => {
  it("returns null when no activity has been recorded", () => {
    const { b, parent } = buildBlock({
      cells: [{ kind: "free", expected: "あ", mode: "show" }],
    });
    expect(b.undo()).toBeNull();
    b.destroy();
    parent.remove();
  });

  it("dedups re-touches of the same cell so a single undo reverts it", () => {
    // Two write-mode free cells; touch cell 0 twice, then cell 1 once.
    // Expect: stack top = cell 1, then cell 0 (re-touch moved cell 0 up
    // but it stays a single entry).
    const { b, parent } = buildBlock({
      cells: [
        { kind: "free", expected: "あ", mode: "write" },
        { kind: "free", expected: "い", mode: "write" },
      ],
    });
    const surfaces = parent.querySelectorAll("svg");
    expect(surfaces.length).toBeGreaterThanOrEqual(2);
    // Stroke cell 0, then cell 0 again, then cell 1.
    strokeAt(surfaces[0] as SVGElement, [[10, 10], [70, 70]], 1);
    strokeAt(surfaces[0] as SVGElement, [[20, 20], [60, 60]], 2);
    strokeAt(surfaces[1] as SVGElement, [[10, 10], [70, 70]], 3);

    const u1 = b.undo();
    expect(u1).toEqual({ kind: "cell", index: 1, hasMore: true });
    const u2 = b.undo();
    expect(u2).toEqual({ kind: "cell", index: 0, hasMore: false });
    const u3 = b.undo();
    expect(u3).toBeNull();
    b.destroy();
    parent.remove();
  });

  it("walks back through annotations as well as cells", () => {
    // Single guided show cell + write annotation. Touching the
    // annotation freeCell should make undo target it.
    const { b, parent } = buildBlock({
      cells: [{ kind: "free", expected: "あ", mode: "show" }],
      annotations: [{ cellRange: [0, 0], expected: "あ", mode: "write" }],
    });
    // The annotation freeCell SVG is appended after the cell SVG; pick
    // the last SVG to avoid grabbing the show-mode cell SVG.
    const allSvgs = parent.querySelectorAll("svg");
    const annotationSvg = allSvgs[allSvgs.length - 1] as SVGElement;
    strokeAt(annotationSvg, [[10, 10], [25, 25]], 1);
    const u = b.undo();
    expect(u).toEqual({ kind: "annotation", index: 0, hasMore: false });
    b.destroy();
    parent.remove();
  });
});
