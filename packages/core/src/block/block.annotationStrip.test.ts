import { describe, it, expect } from "vitest";
import { block } from "./block.js";
import type { BlockSpec } from "./types.js";

const CELL_SIZE = 80;
// cellSize * DEFAULT_ANNOTATION_RATIO (0.4)
const STRIP_THICKNESS = 32;

function mount(spec: BlockSpec, opts: Parameters<typeof block.create>[1] | object = {}) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const b = block.create(parent, {
    spec,
    cellSize: CELL_SIZE,
    loaders: { charDataLoader: null, configLoader: null },
    // Keeps the DOM to strip frames + annotation content: with the grid on,
    // every blank cell also paints a cross-grid SVG.
    showGrid: false,
    ...opts,
  } as Parameters<typeof block.create>[1]);
  const wrapper = parent.firstElementChild as HTMLElement;
  return { parent, b, wrapper };
}

/**
 * Bordered wrappers sitting on the strip side of the block, i.e. the
 * annotation strip frames. Cells carry a border too but sit on the cell
 * side; the annotation overlay sits on the strip side but is borderless.
 */
function stripFrames(wrapper: HTMLElement, writingMode: "vertical-rl" | "horizontal-tb") {
  return Array.from(wrapper.children)
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => el.style.borderTop !== "")
    .filter((el) =>
      writingMode === "vertical-rl"
        ? el.style.left === `${CELL_SIZE}px`
        : el.style.top === "0px" && el.style.height === `${STRIP_THICKNESS}px`,
    )
    .map((el) => ({
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      height: el.style.height,
    }));
}

/** Y positions (vertical-rl) of every rendered show-mode glyph, in order. */
function glyphOffsets(wrapper: HTMLElement, axis: "x" | "y"): number[] {
  return Array.from(wrapper.querySelectorAll("svg text")).map((t) =>
    Number(t.getAttribute(axis)),
  );
}

function svgCount(wrapper: HTMLElement): number {
  return wrapper.querySelectorAll("svg").length;
}

const twoBlankCells: BlockSpec = {
  cells: [{ kind: "blank" }, { kind: "blank" }],
  annotations: [{ cellRange: [0, 1], expected: "がっこう", mode: "show" }],
};

describe("continuousAnnotationStrip", () => {
  it("keeps one frame per cell-slot and one text run per sub-strip by default", () => {
    const { wrapper } = mount(twoBlankCells);
    expect(stripFrames(wrapper, "vertical-rl")).toEqual([
      { left: "80px", top: "0px", width: "32px", height: "80px" },
      { left: "80px", top: "80px", width: "32px", height: "80px" },
    ]);
    // Each sub-strip renders its own share of the reading (2 chars each),
    // so the run is cut by the divider between the two frames.
    expect(svgCount(wrapper)).toBe(2);
    expect(glyphOffsets(wrapper, "y")).toEqual([20, 60, 20, 60]);
  });

  it("replaces the run's per-slot frames with a single run-wide frame", () => {
    const { wrapper } = mount(twoBlankCells, { continuousAnnotationStrip: true });
    expect(stripFrames(wrapper, "vertical-rl")).toEqual([
      { left: "80px", top: "0px", width: "32px", height: "160px" },
    ]);
  });

  it("spaces the reading evenly across the whole run", () => {
    const { wrapper } = mount(twoBlankCells, { continuousAnnotationStrip: true });
    expect(svgCount(wrapper)).toBe(1);
    // 4 chars over 2 cells (160px): slot = 40px, glyph centres at 20/60/100/140.
    expect(glyphOffsets(wrapper, "y")).toEqual([20, 60, 100, 140]);
  });

  it("spaces a non-uniform reading evenly instead of splitting it per cell", () => {
    const spec: BlockSpec = {
      cells: [{ kind: "blank" }, { kind: "blank" }],
      annotations: [{ cellRange: [0, 1], expected: "おとな", mode: "show" }],
    };
    // Default: 2 chars in the first cell, 1 in the second — uneven gaps.
    const off = mount(spec);
    expect(glyphOffsets(off.wrapper, "y")).toEqual([20, 60, 40]);

    // Continuous: 3 chars over 160px, slot = 160/3.
    const on = mount(spec, { continuousAnnotationStrip: true });
    const slot = 160 / 3;
    expect(glyphOffsets(on.wrapper, "y")).toEqual([0.5, 1.5, 2.5].map((i) => i * slot));
  });

  it("leaves cell-slots outside the run framed per slot", () => {
    const { wrapper } = mount(
      {
        cells: [{ kind: "blank" }, { kind: "blank" }, { kind: "blank" }],
        annotations: [{ cellRange: [0, 1], expected: "がっこう", mode: "show" }],
      },
      { continuousAnnotationStrip: true },
    );
    expect(stripFrames(wrapper, "vertical-rl")).toEqual([
      { left: "80px", top: "160px", width: "32px", height: "80px" },
      { left: "80px", top: "0px", width: "32px", height: "160px" },
    ]);
  });

  it("leaves a single-cell annotation unchanged", () => {
    const { wrapper } = mount(
      {
        cells: [{ kind: "blank" }],
        annotations: [{ cellRange: [0, 0], expected: "がく", mode: "show" }],
      },
      { continuousAnnotationStrip: true },
    );
    expect(stripFrames(wrapper, "vertical-rl")).toEqual([
      { left: "80px", top: "0px", width: "32px", height: "80px" },
    ]);
  });

  it("keeps write-mode annotations partitioned per cell", () => {
    const { wrapper } = mount(
      {
        cells: [{ kind: "blank" }, { kind: "blank" }],
        annotations: [{ cellRange: [0, 1], expected: "がっこう", mode: "write" }],
      },
      { continuousAnnotationStrip: true },
    );
    // One frame per cell-slot: freeCell normalizes each character inside
    // the surface it was drawn on, so the writer needs the boundaries.
    expect(stripFrames(wrapper, "vertical-rl")).toEqual([
      { left: "80px", top: "0px", width: "32px", height: "80px" },
      { left: "80px", top: "80px", width: "32px", height: "80px" },
    ]);
    // Two writable surfaces, one per cell.
    expect(svgCount(wrapper)).toBe(2);
  });

  it("merges along the cell axis for horizontal-tb too", () => {
    const { wrapper } = mount(twoBlankCells, {
      writingMode: "horizontal-tb",
      continuousAnnotationStrip: true,
    });
    expect(stripFrames(wrapper, "horizontal-tb")).toEqual([
      { left: "0px", top: "0px", width: "160px", height: "32px" },
    ]);
    expect(glyphOffsets(wrapper, "x")).toEqual([20, 60, 100, 140]);
  });
});
