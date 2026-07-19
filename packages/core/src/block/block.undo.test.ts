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

// "い" needs two strokes; every other char settles in one. A single
// stroke into an "い" cell therefore leaves it mid-character (never
// captured), which is exactly the "currently being written" state the
// undo-ordering tests below rely on.
const twoStrokeForI: CharDataLoaderFn = (c, onLoad) => {
  if (c === "い") {
    onLoad({
      strokes: ["M 0 0 L 100 100", "M 0 0 L 100 100"],
      medians: [
        [[0, 0], [100, 100]],
        [[0, 0], [100, 100]],
      ],
    });
    return;
  }
  onLoad({
    strokes: ["M 0 0 L 100 100"],
    medians: [[[0, 0], [100, 100]]],
  });
};

function buildDeferredBlock(spec: BlockSpec, loader: CharDataLoaderFn) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const b = block.create(parent, {
    spec,
    cellSize: 80,
    correction: "per-block",
    loaders: { charDataLoader: loader, configLoader: null },
  });
  return { parent, b };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  it("free per-block: undo targets the cell being written, not one that captured earlier", async () => {
    // Regression: in a deferred/per-block block a cell's capture is
    // asynchronous, landing after the user has already moved on to the
    // next cell. Undo must revert the cell currently being written, not
    // the earlier one whose (late) capture would otherwise re-sort it to
    // the top of the activity stack.
    const { b, parent } = buildDeferredBlock(
      {
        cells: [
          { kind: "free", expected: "あ", mode: "write" },
          { kind: "free", expected: "い", mode: "write" },
        ],
      },
      twoStrokeForI,
    );
    const surfaces = parent.querySelectorAll("svg");
    // Complete cell 0 (single stroke → matches → captures async).
    strokeAt(surfaces[0] as SVGElement, [[10, 10], [70, 70]], 1);
    // Start cell 1 (needs two strokes → one stroke leaves it mid-write).
    strokeAt(surfaces[1] as SVGElement, [[10, 10], [70, 70]], 2);
    // Let cell 0's async match settle so its capture callback fires.
    await wait(100);

    const u = b.undo();
    expect(u).toEqual({ kind: "cell", index: 1, hasMore: true });
    b.destroy();
    parent.remove();
  });

  it("guided per-block: undo targets the in-progress cell, not the captured one", async () => {
    // Same regression for guided cells, where the failure is
    // deterministic: under per-block deferral the per-stroke verdict
    // callbacks are suppressed, so before the fix the ONLY activity
    // signal was the char-completion capture, leaving a half-written
    // second cell invisible to undo.
    const { b, parent } = buildDeferredBlock(
      {
        cells: [
          { kind: "guided", char: "あ", mode: "write" },
          { kind: "guided", char: "い", mode: "write" },
        ],
      },
      twoStrokeForI,
    );
    await wait(50);
    const writerSvgs = Array.from(
      parent.querySelectorAll<SVGSVGElement>("svg"),
    ).filter((s) => s.querySelector(":scope > defs") !== null);

    // Complete cell 0 (single stroke → captured).
    strokeAt(writerSvgs[0], [[10, 40], [70, 40]], 1);
    await wait(100);
    // Start cell 1 (needs two strokes → one stroke leaves it mid-write,
    // never captured).
    strokeAt(writerSvgs[1], [[10, 40], [70, 40]], 2);
    await wait(50);

    const u = b.undo();
    expect(u).toEqual({ kind: "cell", index: 1, hasMore: true });
    b.destroy();
    parent.remove();
  });
});
