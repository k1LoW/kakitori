import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { char } from "./char.js";
import { block } from "./block/index.js";
import { page } from "./page/index.js";
import { HANZI_Y_MAX } from "./constants.js";
import type {
  CharDataLoaderFn,
  CharResult,
  CharStrokeResult,
} from "./charOptions.js";
import type { BlockResult } from "./block/types.js";
import type { PageResult } from "./page/types.js";

const mockCharData = {
  strokes: ["M 0 0 L 100 100", "M 200 200 L 300 300"],
  medians: [
    [
      [0, 0],
      [100, 100],
    ],
    [
      [200, 200],
      [300, 300],
    ],
  ],
};

const mockCharDataLoader: CharDataLoaderFn = (_char, onLoad) => {
  onLoad(mockCharData);
};

function strokeWithPoints(
  matched: boolean,
  raw: ReadonlyArray<[number, number, number]>,
): CharStrokeResult {
  return {
    matched,
    similarity: matched ? 0.9 : 0,
    points: raw.map(([x, y, t]) => ({ x, y, t })),
  };
}

function charResult(
  character: string,
  strokes: ReadonlyArray<CharStrokeResult>,
  extras: Partial<CharResult> = {},
): CharResult {
  return {
    character,
    complete: true,
    matched: strokes.every((s) => s.matched),
    perStroke: [...strokes],
    ...extras,
  };
}

function getRestoreSvg(host: HTMLElement): SVGSVGElement {
  const svg = host.querySelector<SVGSVGElement>("svg.kakitori-restore-svg");
  if (!svg) {
    throw new Error("expected a kakitori-restore-svg under host");
  }
  return svg;
}

function getPolylines(svg: SVGSVGElement): SVGPolylineElement[] {
  return Array.from(svg.querySelectorAll("polyline"));
}

describe("char.restore", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("paints one polyline per stored stroke with points", () => {
    const result = charResult("学", [
      strokeWithPoints(true, [
        [100, HANZI_Y_MAX - 50, 0],
        [200, HANZI_Y_MAX - 50, 100],
      ]),
      strokeWithPoints(true, [
        [50, HANZI_Y_MAX - 200, 200],
        [50, HANZI_Y_MAX - 300, 300],
      ]),
    ]);
    char.restore(host, result, { size: 200 });

    const polylines = getPolylines(getRestoreSvg(host));
    expect(polylines).toHaveLength(2);
    // First polyline's points string mirrors the internal coords.
    expect(polylines[0].getAttribute("points")).toBe(
      `100,${HANZI_Y_MAX - 50} 200,${HANZI_Y_MAX - 50}`,
    );
    // Non-scaling-stroke keeps drawingWidth in display px.
    expect(polylines[0].getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("skips strokes with missing or too-short points", () => {
    const result = charResult("学", [
      { matched: true, similarity: 0 }, // no points
      strokeWithPoints(true, [[0, 0, 0]]), // length < 2
      strokeWithPoints(true, [
        [0, 0, 0],
        [10, 10, 100],
      ]),
    ]);
    char.restore(host, result, { size: 200 });
    expect(getPolylines(getRestoreSvg(host))).toHaveLength(1);
  });

  it("colors matched strokes with okColor and mismatched with ngColor when set", () => {
    const result = charResult("学", [
      strokeWithPoints(true, [
        [0, 0, 0],
        [10, 10, 50],
      ]),
      strokeWithPoints(false, [
        [20, 20, 0],
        [30, 30, 50],
      ]),
    ]);
    char.restore(host, result, {
      size: 200,
      okColor: "#0a0",
      ngColor: "#a00",
    });

    const polylines = getPolylines(getRestoreSvg(host));
    expect(polylines[0].getAttribute("stroke")).toBe("#0a0");
    expect(polylines[1].getAttribute("stroke")).toBe("#a00");
  });

  it("falls back to drawingColor for both ok / ng when okColor / ngColor unset", () => {
    const result = charResult("学", [
      strokeWithPoints(true, [
        [0, 0, 0],
        [10, 10, 50],
      ]),
      strokeWithPoints(false, [
        [20, 20, 0],
        [30, 30, 50],
      ]),
    ]);
    char.restore(host, result, {
      size: 200,
      drawingColor: "#123456",
    });

    const polylines = getPolylines(getRestoreSvg(host));
    expect(polylines[0].getAttribute("stroke")).toBe("#123456");
    expect(polylines[1].getAttribute("stroke")).toBe("#123456");
  });

  it("auto-enables showCharacter for mode === \"show\" results", () => {
    const result: CharResult = {
      character: "学",
      complete: true,
      matched: true,
      perStroke: [],
      mode: "show",
    };
    char.restore(host, result, {
      size: 200,
      charDataLoader: mockCharDataLoader,
    });

    const svg = getRestoreSvg(host);
    expect(getPolylines(svg)).toHaveLength(0);
    // Reference paths from mockCharData land inside the <g>.
    const paths = svg.querySelectorAll("path");
    expect(paths.length).toBe(mockCharData.strokes.length);
  });

  it("draws the cross-grid by default (showGrid undefined matches create-side default)", () => {
    const result = charResult("学", [
      strokeWithPoints(true, [
        [0, 0, 0],
        [10, 10, 50],
      ]),
    ]);
    char.restore(host, result, { size: 200 });
    const svg = getRestoreSvg(host);
    const lines = svg.querySelectorAll("line");
    expect(lines.length).toBeGreaterThanOrEqual(2); // grid = vertical + horizontal
  });

  it("suppresses the cross-grid when showGrid: false", () => {
    const result = charResult("学", [
      strokeWithPoints(true, [
        [0, 0, 0],
        [10, 10, 50],
      ]),
    ]);
    char.restore(host, result, { size: 200, showGrid: false });
    const svg = getRestoreSvg(host);
    expect(svg.querySelectorAll("line").length).toBe(0);
  });

  it("paints the reference outline with outlineColor when showOutline: true", () => {
    const result: CharResult = {
      character: "学",
      complete: true,
      matched: true,
      perStroke: [],
    };
    char.restore(host, result, {
      size: 200,
      showOutline: true,
      outlineColor: "#abcdef",
      charDataLoader: mockCharDataLoader,
    });

    const svg = getRestoreSvg(host);
    const paths = svg.querySelectorAll("path");
    expect(paths.length).toBe(mockCharData.strokes.length);
    paths.forEach((p) => {
      expect(p.getAttribute("fill")).toBe("#abcdef");
    });
  });

  it("layers outline behind the filled character when both are set", () => {
    const result: CharResult = {
      character: "学",
      complete: true,
      matched: true,
      perStroke: [],
    };
    char.restore(host, result, {
      size: 200,
      showCharacter: true,
      showOutline: true,
      strokeColor: "#111111",
      outlineColor: "#eeeeee",
      charDataLoader: mockCharDataLoader,
    });

    const svg = getRestoreSvg(host);
    const paths = svg.querySelectorAll("path");
    expect(paths.length).toBe(mockCharData.strokes.length * 2);
    // First N paths are outline (painted first → behind), next N are character.
    for (let i = 0; i < mockCharData.strokes.length; i++) {
      expect(paths[i].getAttribute("fill")).toBe("#eeeeee");
    }
    for (let i = mockCharData.strokes.length; i < paths.length; i++) {
      expect(paths[i].getAttribute("fill")).toBe("#111111");
    }
  });

  it("does not load char data when showCharacter is left false (default)", () => {
    let loadCount = 0;
    const countingLoader: CharDataLoaderFn = (_c, onLoad) => {
      loadCount++;
      onLoad(mockCharData);
    };
    const result = charResult("学", [
      strokeWithPoints(true, [
        [0, 0, 0],
        [10, 10, 50],
      ]),
    ]);
    char.restore(host, result, {
      size: 200,
      charDataLoader: countingLoader,
    });
    expect(loadCount).toBe(0);
  });

  it("replaces previously-restored SVG on repeated calls", () => {
    const result = charResult("学", [
      strokeWithPoints(true, [
        [0, 0, 0],
        [10, 10, 50],
      ]),
    ]);
    char.restore(host, result, { size: 200 });
    char.restore(host, result, { size: 200 });
    // Only the most recent restore SVG remains as a direct child.
    expect(host.querySelectorAll(":scope > svg.kakitori-restore-svg")).toHaveLength(1);
  });

  it("discards stale async loader callbacks when a follow-up call supersedes them", () => {
    // Stash each loader's resolver so the test can finish the loads
    // out of order on purpose: the second call's data lands first,
    // then the first call's data lands second. Without a generation
    // guard the older callback would re-clear the target and append
    // its stale SVG, overwriting the newer render.
    const pending: Array<{ char: string; resolve: (d: typeof mockCharData) => void }> = [];
    const slowLoader: CharDataLoaderFn = (ch, onLoad) => {
      pending.push({ char: ch, resolve: onLoad });
    };
    const firstResult: CharResult = {
      character: "一",
      complete: true,
      matched: true,
      perStroke: [],
      mode: "show",
    };
    const secondResult: CharResult = {
      character: "二",
      complete: true,
      matched: true,
      perStroke: [],
      mode: "show",
    };

    char.restore(host, firstResult, { size: 200, charDataLoader: slowLoader });
    char.restore(host, secondResult, { size: 200, charDataLoader: slowLoader });

    // Resolve newer first.
    pending[1].resolve(mockCharData);
    // Then resolve the stale older call.
    pending[0].resolve(mockCharData);

    // Exactly one SVG remains in the target (no double-render), and
    // there's no stale ghost SVG from the older callback.
    expect(host.querySelectorAll(":scope > svg.kakitori-restore-svg")).toHaveLength(1);
  });

  it("throws when size is non-positive", () => {
    const result = charResult("学", []);
    expect(() => char.restore(host, result, { size: 0 })).toThrow(
      /size must be positive/,
    );
    expect(() => char.restore(host, result, { size: -5 })).toThrow();
  });

  it("throws when target selector matches nothing", () => {
    const result = charResult("学", []);
    expect(() => char.restore("#does-not-exist", result, { size: 200 })).toThrow(
      /target selector/,
    );
  });
});

describe("block.restore", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  function getBlockWrapper(): HTMLElement {
    const wrapper = host.querySelector<HTMLElement>(".kakitori-block-restore");
    if (!wrapper) {
      throw new Error("expected a kakitori-block-restore wrapper under host");
    }
    return wrapper;
  }

  it("places one cell per BlockResult.cells entry in declaration order (vertical-rl)", () => {
    const result: BlockResult = {
      complete: true,
      matched: true,
      cells: [
        {
          kind: "guided",
          chars: [charResult("一", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])])],
        },
        {
          kind: "guided",
          chars: [charResult("二", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])])],
        },
      ],
      annotations: [],
    };
    block.restore(host, result, { cellSize: 100 });

    const wrapper = getBlockWrapper();
    // Two cell wrappers stacked top-to-bottom.
    const cellWrappers = wrapper.querySelectorAll<HTMLElement>(
      ":scope > div",
    );
    expect(cellWrappers).toHaveLength(2);
    expect(cellWrappers[0].style.top).toBe("0px");
    expect(cellWrappers[1].style.top).toBe("100px");
    // Both cells render their char polyline.
    const svgs = wrapper.querySelectorAll("svg.kakitori-restore-svg");
    expect(svgs).toHaveLength(2);
  });

  it("free cell occupies chars.length slots with individual char.restore SVGs", () => {
    const result: BlockResult = {
      complete: true,
      matched: true,
      cells: [
        {
          kind: "free",
          chars: [
            charResult("が", [
              strokeWithPoints(true, [
                [0, 0, 0],
                [10, 10, 50],
              ]),
            ]),
            charResult("っ", [
              strokeWithPoints(true, [
                [0, 0, 0],
                [10, 10, 50],
              ]),
            ]),
            charResult("こ", [
              strokeWithPoints(true, [
                [0, 0, 0],
                [10, 10, 50],
              ]),
            ]),
            charResult("う", [
              strokeWithPoints(true, [
                [0, 0, 0],
                [10, 10, 50],
              ]),
            ]),
          ],
        },
      ],
      annotations: [],
    };
    block.restore(host, result, { cellSize: 60, writingMode: "horizontal-tb" });

    const wrapper = getBlockWrapper();
    expect(wrapper.style.width).toBe("240px"); // 4 slots × 60
    expect(wrapper.style.height).toBe("60px");
    // One cellWrapper that wraps 4 slot divs, each with its own char.restore svg.
    expect(wrapper.querySelectorAll("svg.kakitori-restore-svg")).toHaveLength(4);
  });

  it("honours explicit span carried over from the spec for free / blank cells", () => {
    // Free cell with span=5 but only 2 matched chars: the wrapper must
    // still be 5 slots wide so layouts that reserved extra width are
    // restored faithfully. Blank cell with span=3 mirrors the same
    // intent for visual placeholders.
    const result: BlockResult = {
      complete: true,
      matched: true,
      cells: [
        {
          kind: "free",
          chars: [
            charResult("学", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
            charResult("校", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
          ],
          span: 5,
        },
        { kind: "blank", chars: [], span: 3 },
      ],
      annotations: [],
    };
    block.restore(host, result, { cellSize: 50, writingMode: "horizontal-tb" });

    const wrapper = getBlockWrapper();
    // (5 + 3) slots × 50px = 400px total.
    expect(wrapper.style.width).toBe("400px");
    const cellWrappers = wrapper.querySelectorAll<HTMLElement>(":scope > div");
    expect(cellWrappers).toHaveLength(2);
    expect(cellWrappers[0].style.width).toBe("250px"); // free cell, 5 slots
    expect(cellWrappers[1].style.width).toBe("150px"); // blank cell, 3 slots
  });

  it("blank cell renders one bordered slot per span unit; outer wrapper has no border", () => {
    const result: BlockResult = {
      complete: true,
      matched: true,
      cells: [{ kind: "blank", chars: [], span: 3 }],
      annotations: [],
    };
    block.restore(host, result, { cellSize: 50 });

    const wrapper = getBlockWrapper();
    const cellWrapper = wrapper.querySelector<HTMLElement>(":scope > div")!;
    // Outer wrapper has no border — the per-slot borders fill in below.
    expect(cellWrapper.style.borderTopWidth).toBe("");
    // One slot per span unit, each with its own border + its own SVG.
    const slots = cellWrapper.querySelectorAll<HTMLElement>(":scope > div");
    expect(slots).toHaveLength(3);
    slots.forEach((s) => {
      expect(s.style.borderTopWidth).not.toBe("");
      expect(s.style.width).toBe("50px");
    });
    expect(wrapper.querySelectorAll("svg.kakitori-restore-svg")).toHaveLength(3);
  });

  it("free cell with span > chars.length fills trailing slots with empty chrome", () => {
    const result: BlockResult = {
      complete: true,
      matched: true,
      cells: [
        {
          kind: "free",
          chars: [
            charResult("学", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
            charResult("校", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
          ],
          span: 5,
        },
      ],
      annotations: [],
    };
    block.restore(host, result, { cellSize: 50, writingMode: "horizontal-tb" });

    const wrapper = getBlockWrapper();
    // 5 slot SVGs even though only 2 chars: trailing 3 slots render
    // empty chrome instead of being blank space.
    const svgs = wrapper.querySelectorAll("svg.kakitori-restore-svg");
    expect(svgs).toHaveLength(5);
    // First 2 carry polylines, last 3 don't.
    const polylineCounts = Array.from(svgs).map(
      (s) => s.querySelectorAll("polyline").length,
    );
    expect(polylineCounts).toEqual([1, 1, 0, 0, 0]);
  });

  it("blank cell paints chrome only (no polyline)", () => {
    const result: BlockResult = {
      complete: true,
      matched: true,
      cells: [{ kind: "blank", chars: [] }],
      annotations: [],
    };
    block.restore(host, result, { cellSize: 80 });

    const wrapper = getBlockWrapper();
    const svgs = wrapper.querySelectorAll("svg.kakitori-restore-svg");
    expect(svgs).toHaveLength(1);
    expect(svgs[0].querySelectorAll("polyline")).toHaveLength(0);
  });

  it("renders the cross-grid in block-context defaults (border color, 3,3 dash) when showGrid is left default", () => {
    // block.create translates `showGrid: true` into a GridOptions
    // matching the cell border style with dashArray "3,3". block.restore
    // should mirror that, instead of forwarding a bare `true` to
    // charRestore (which would fall through to drawCrossGrid's char-context
    // defaults — color "#ccc", dashArray "10,10", width 2).
    const result: BlockResult = {
      complete: true,
      matched: true,
      cells: [
        {
          kind: "guided",
          chars: [
            charResult("一", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
          ],
        },
      ],
      annotations: [],
    };
    block.restore(host, result, {
      cellSize: 50,
      cellBorderColor: "#abcdef",
      cellBorderWidth: 2,
    });

    const wrapper = getBlockWrapper();
    const lines = wrapper.querySelectorAll("svg.kakitori-restore-svg line");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    lines.forEach((line) => {
      expect(line.getAttribute("stroke")).toBe("#abcdef");
      expect(line.getAttribute("stroke-width")).toBe("2");
      expect(line.getAttribute("stroke-dasharray")).toBe("3,3");
    });
  });

  it("renders annotation strip when BlockAnnotationResult carries layout", () => {
    // Two-cell block with a furigana annotation across both cells.
    // Annotation contributes the strip thickness and renders its chars
    // across sub-strips on the right (vertical-rl default placement).
    const result: BlockResult = {
      complete: true,
      matched: true,
      cells: [
        {
          kind: "guided",
          chars: [
            charResult("学", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
          ],
        },
        {
          kind: "guided",
          chars: [
            charResult("校", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
          ],
        },
      ],
      annotations: [
        {
          cellRange: [0, 1],
          chars: ["が", "っ", "こ", "う"].map((c) =>
            charResult(c, [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
          ),
        },
      ],
    };
    block.restore(host, result, { cellSize: 100 });

    const wrapper = getBlockWrapper();
    // vertical-rl: wrapper width = cellSize + annotationThickness
    // (annotationThickness = DEFAULT_ANNOTATION_RATIO * cellSize = 40).
    expect(wrapper.style.width).toBe("140px");
    // height = 2 cells * 100.
    expect(wrapper.style.height).toBe("200px");
    // 2 cell SVGs + 4 annotation char SVGs = 6 restore SVGs total.
    expect(wrapper.querySelectorAll("svg.kakitori-restore-svg")).toHaveLength(6);
  });

  it("throws on annotation placement that doesn't match the writing mode", () => {
    const result: BlockResult = {
      complete: true,
      matched: true,
      cells: [
        {
          kind: "guided",
          chars: [
            charResult("学", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
          ],
        },
      ],
      annotations: [
        {
          cellRange: [0, 0],
          placement: "bottom",
          chars: [
            charResult("が", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
          ],
        },
      ],
    };
    expect(() => block.restore(host, result, { cellSize: 80 })).toThrow(
      /placement must be/,
    );
  });

  it("throws when an explicit BlockCellResult.span is not a positive integer", () => {
    const malformed: BlockResult = {
      complete: true,
      matched: true,
      cells: [{ kind: "blank", chars: [], span: 0 }],
      annotations: [],
    };
    expect(() => block.restore(host, malformed, { cellSize: 50 })).toThrow(
      /span must be a positive integer/,
    );

    const fractional: BlockResult = {
      complete: true,
      matched: true,
      cells: [{ kind: "blank", chars: [], span: 1.5 }],
      annotations: [],
    };
    expect(() => block.restore(host, fractional, { cellSize: 50 })).toThrow(
      /span must be a positive integer/,
    );

    const negative: BlockResult = {
      complete: true,
      matched: true,
      cells: [{ kind: "free", chars: [charResult("一", [strokeWithPoints(true, [[0,0,0],[10,10,50]])])], span: -1 }],
      annotations: [],
    };
    expect(() => block.restore(host, negative, { cellSize: 50 })).toThrow(
      /span must be a positive integer/,
    );
  });

  it("throws on invalid cellSize or writingMode", () => {
    const empty: BlockResult = {
      complete: true,
      matched: true,
      cells: [],
      annotations: [],
    };
    expect(() => block.restore(host, empty, { cellSize: 0 })).toThrow(
      /cellSize must be a finite positive number/,
    );
    expect(() =>
      block.restore(host, empty, {
        cellSize: 60,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        writingMode: "diagonal" as any,
      }),
    ).toThrow(/writingMode must be/);
  });
});

describe("page.restore", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("places blocks across columns with the same flow as page.create (vertical-rl)", () => {
    const oneStrokeBlock = (chars: string[]): BlockResult => ({
      complete: true,
      matched: true,
      cells: chars.map((c) => ({
        kind: "guided" as const,
        chars: [
          charResult(c, [
            strokeWithPoints(true, [
              [0, 0, 0],
              [10, 10, 50],
            ]),
          ]),
        ],
      })),
      annotations: [],
    });
    const result: PageResult = {
      complete: true,
      matched: true,
      blocks: [oneStrokeBlock(["一", "二", "三", "四"]), oneStrokeBlock(["五", "六"])],
    };
    page.restore(host, result, {
      columns: 2,
      cellsPerColumn: 4,
      cellSize: 50,
    });

    const wrapper = host.querySelector<HTMLElement>(".kakitori-page-restore")!;
    expect(wrapper.style.width).toBe("100px"); // 2 cols × 50
    expect(wrapper.style.height).toBe("200px"); // 4 cells × 50
    // Two segments expected: block 0 (4 cells fits column 0), block 1 (2 cells
    // in column 1). Each segment has its own positioned slot under the wrapper.
    const segments = wrapper.querySelectorAll<HTMLElement>(":scope > div");
    expect(segments).toHaveLength(2);
    // vertical-rl: column 0 is the rightmost. block 0 lands at x=50, block 1 at x=0.
    expect(segments[0].style.left).toBe("50px");
    expect(segments[1].style.left).toBe("0px");
  });

  it("forces a following block to the next column when a prior free cell's span exceeds chars.length", () => {
    // Regression: page.restore -> blockResultToSpec used to drop
    // BlockCellResult.span when synthesizing cells for layoutPage, so a
    // 4-cellsPerColumn column would happily fit a free cell with
    // span:4 + chars.length:2 alongside a following 1-char block
    // (treating the free cell as 2 slots wide). Preserve span so
    // layoutPage sees the real width and pushes the next block to
    // column 1.
    const wideFree: BlockResult = {
      complete: true,
      matched: true,
      cells: [
        {
          kind: "free",
          chars: [
            charResult("一", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
            charResult("二", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
          ],
          span: 4,
        },
      ],
      annotations: [],
    };
    const followUp: BlockResult = {
      complete: true,
      matched: true,
      cells: [
        {
          kind: "guided",
          chars: [
            charResult("三", [strokeWithPoints(true, [[0, 0, 0], [10, 10, 50]])]),
          ],
        },
      ],
      annotations: [],
    };
    const result: PageResult = {
      complete: true,
      matched: true,
      blocks: [wideFree, followUp],
    };

    page.restore(host, result, { columns: 2, cellsPerColumn: 4, cellSize: 50 });

    const wrapper = host.querySelector<HTMLElement>(".kakitori-page-restore")!;
    const segments = wrapper.querySelectorAll<HTMLElement>(":scope > div");
    expect(segments).toHaveLength(2);
    // vertical-rl: column 0 (right) sits at x=50, column 1 (left) at x=0.
    // wideFree consumes column 0 in full; followUp is pushed to column 1.
    expect(segments[0].style.left).toBe("50px");
    expect(segments[1].style.left).toBe("0px");
  });

  it("throws on invalid layout dimensions", () => {
    const empty: PageResult = { complete: true, matched: true, blocks: [] };
    expect(() => page.restore(host, empty, { columns: 0, cellsPerColumn: 4, cellSize: 50 })).toThrow(
      /columns must be a positive integer/,
    );
    expect(() => page.restore(host, empty, { columns: 2, cellsPerColumn: 0, cellSize: 50 })).toThrow(
      /cellsPerColumn must be a positive integer/,
    );
  });
});
