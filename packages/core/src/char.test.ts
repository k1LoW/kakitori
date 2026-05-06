import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { char, computeMedianPathLength } from "./char.js";
import type {
  CharCreateOptions,
  CharDataLoaderFn,
  MountOptions,
} from "./charOptions.js";

// Test helper: previously most tests called `createMounted(container, "あ", opts)`.
// After the headless-first refactor, create no longer takes a target and
// options are split into CharCreateOptions (headless) + MountOptions (DOM).
// This helper preserves the legacy ergonomics by splitting the options bag.
function createMounted(
  container: HTMLElement,
  character: string,
  opts: CharCreateOptions & MountOptions = {},
): ReturnType<typeof char.create> {
  const {
    logger,
    configLoader,
    charDataLoader,
    strokeGroups,
    leniency,
    strokeEndingStrictness,
    ...mountOpts
  } = opts;
  const c = char.create(character, {
    logger,
    configLoader,
    charDataLoader,
    strokeGroups,
    leniency,
    strokeEndingStrictness,
  });
  c.mount(container, mountOpts);
  return c;
}

const mockCharData = {
  strokes: [
    "M 0 0 L 100 100",
    "M 200 200 L 300 300",
  ],
  medians: [
    [[0, 0], [100, 100]],
    [[200, 200], [300, 300]],
  ],
};

const mockCharDataLoader: CharDataLoaderFn = (_char, onLoad) => {
  onLoad(mockCharData);
};

describe("char", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  // Construct the SVG layering that hanzi-writer's getStrokePaths walks:
  //   <svg> > <g> > <g outline>(path[clip-path] x 2)
  //                   <g main>(path[clip-path] x 2)   ← what we manipulate
  //                   <g highlight>(path[clip-path] x 2)
  // Real getStrokePaths picks groupsWithPaths[1] (main) and returns its
  // paths in order. By writing this DOM ourselves, the production path
  // lookup runs unchanged and tests don't need to reach into char's
  // closure to swap implementations.
  //
  // Reuses the existing outer <g> (clearing it) so hanzi-writer's own
  // children don't bleed into `:scope > g > g` and shift the main-group
  // index past 1.
  function createWithStrokePaths() {
    const k = createMounted(container, "あ", {
      charDataLoader: mockCharDataLoader,
      configLoader: null,
    });
    const hwSvg = container.querySelector("svg") as SVGSVGElement;
    const ns = "http://www.w3.org/2000/svg";
    let outerG = hwSvg.querySelector(":scope > g") as SVGGElement | null;
    if (!outerG) {
      outerG = document.createElementNS(ns, "g") as SVGGElement;
      hwSvg.appendChild(outerG);
    }
    outerG.innerHTML = "";
    const groupPaths: SVGPathElement[][] = [];
    for (let gIdx = 0; gIdx < 3; gIdx++) {
      const g = document.createElementNS(ns, "g") as SVGGElement;
      outerG.appendChild(g);
      const paths: SVGPathElement[] = [];
      for (let i = 0; i < 2; i++) {
        const path = document.createElementNS(ns, "path") as SVGPathElement;
        path.setAttribute("clip-path", `url(#mask-${gIdx}-${i})`);
        path.style.stroke = "#555";
        g.appendChild(path);
        paths.push(path);
      }
      groupPaths.push(paths);
    }
    // The main group is index 1 in groupsWithPaths; setStrokeColor will
    // mutate these.
    return { k, paths: groupPaths[1] };
  }

  describe("create", () => {
    it("creates a Char instance", () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      expect(typeof k.start).toBe("function");
      expect(typeof k.destroy).toBe("function");
    });

    it("creates SVG inside the container", () => {
      createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
    });

    it("respects size option", () => {
      createMounted(container, "あ", {
        size: 200,
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("width")).toBe("200");
      expect(svg?.getAttribute("height")).toBe("200");
    });

    it("throws when size is NaN", () => {
      expect(() => {
        createMounted(container, "あ", {
          size: Number.NaN,
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
      }).toThrow("size must be finite");
    });

    it("throws when padding is Infinity", () => {
      expect(() => {
        createMounted(container, "あ", {
          padding: Number.POSITIVE_INFINITY,
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
      }).toThrow("padding must be finite");
    });

    it("throws when padding is negative", () => {
      expect(() => {
        createMounted(container, "あ", {
          padding: -1,
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
      }).toThrow("padding must be non-negative");
    });

    it("throws when size is zero", () => {
      expect(() => {
        createMounted(container, "あ", {
          size: 0,
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
      }).toThrow("size must be positive");
    });

    it("throws when size is negative", () => {
      expect(() => {
        createMounted(container, "あ", {
          size: -10,
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
      }).toThrow("size must be positive");
    });

    it("throws when padding >= size/2", () => {
      expect(() => {
        createMounted(container, "あ", {
          size: 100,
          padding: 50,
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
      }).toThrow("padding (50) must be less than size/2");
    });
  });

  describe("render", () => {
    it("renders SVG paths for character strokes", () => {
      char.render(container, "あ", {
        charDataLoader: mockCharDataLoader,
      });
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      const paths = svg!.querySelectorAll("path");
      expect(paths).toHaveLength(mockCharData.strokes.length);
    });

    it("respects size and padding options", () => {
      char.render(container, "あ", {
        size: 100,
        padding: 10,
        charDataLoader: mockCharDataLoader,
      });
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("width")).toBe("100");
      expect(svg?.getAttribute("height")).toBe("100");
    });

    it("throws when size is NaN", () => {
      expect(() => {
        char.render(container, "あ", {
          size: Number.NaN,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("size must be finite");
    });

    it("throws when padding is Infinity", () => {
      expect(() => {
        char.render(container, "あ", {
          padding: Number.POSITIVE_INFINITY,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("padding must be finite");
    });

    it("throws when padding is negative", () => {
      expect(() => {
        char.render(container, "あ", {
          padding: -1,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("padding must be non-negative");
    });

    it("throws when size is zero", () => {
      expect(() => {
        char.render(container, "あ", {
          size: 0,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("size must be positive");
    });

    it("throws when size is negative", () => {
      expect(() => {
        char.render(container, "あ", {
          size: -10,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("size must be positive");
    });

    it("throws when padding >= size/2", () => {
      expect(() => {
        char.render(container, "あ", {
          size: 100,
          padding: 50,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("padding (50) must be less than size/2");
    });

    it("applies strokeColor to paths", () => {
      char.render(container, "あ", {
        strokeColor: "#f00",
        charDataLoader: mockCharDataLoader,
      });
      const paths = container.querySelectorAll("svg path");
      for (const path of paths) {
        expect(path.getAttribute("fill")).toBe("#f00");
      }
    });

    it("adds click listener when onClick is provided", () => {
      const onClick = vi.fn();
      char.render(container, "あ", {
        charDataLoader: mockCharDataLoader,
        onClick,
      });
      const svg = container.querySelector("svg")!;
      expect(svg.style.cursor).toBe("pointer");
      svg.dispatchEvent(new Event("click"));
      expect(onClick).toHaveBeenCalledWith({ character: "あ" });
    });

    it("does not add click listener when onClick is not provided", () => {
      char.render(container, "あ", {
        charDataLoader: mockCharDataLoader,
      });
      const svg = container.querySelector("svg")!;
      expect(svg.style.cursor).not.toBe("pointer");
    });

    it("throws when target selector does not match", () => {
      expect(() => {
        char.render("#nonexistent", "あ", {
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("did not match any element");
    });

    it("logs error on load failure", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const failLoader: CharDataLoaderFn = (_char, _onLoad, onError) => {
        onError(new Error("load failed"));
      };
      char.render(container, "あ", {
        charDataLoader: failLoader,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("failed to load"),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it("applies correct SVG transform for coordinate system", () => {
      char.render(container, "あ", {
        size: 300,
        padding: 20,
        charDataLoader: mockCharDataLoader,
      });
      const g = container.querySelector("svg g");
      const transform = g?.getAttribute("transform");
      expect(transform).toContain("translate");
      expect(transform).toContain("scale");
    });
  });

  describe("ready", () => {
    it("resolves when configLoader is null", async () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await expect(k.ready()).resolves.toBeUndefined();
    });

    it("resolves after config loads", async () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: async () => ({
          character: "あ",
          strokeEndings: [{ types: ["tome"] }, { types: ["tome"] }],
        }),
      });
      await k.ready();
      const endings = k.getStrokeEndings();
      expect(endings).toHaveLength(2);
    });
  });

  describe("getStrokeEndings / getStrokeGroups", () => {
    it("returns null when no config loaded", () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      expect(k.getStrokeEndings()).toBeNull();
      expect(k.getStrokeGroups()).toBeNull();
    });

    it("returns config values after loading", async () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: async () => ({
          character: "あ",
          strokeGroups: [[0], [1]],
          strokeEndings: [{ types: ["tome"] }, { types: ["harai"] }],
        }),
      });
      await k.ready();
      expect(k.getStrokeEndings()).toEqual([
        { types: ["tome"] },
        { types: ["harai"] },
      ]);
      expect(k.getStrokeGroups()).toEqual([[0], [1]]);
    });
  });

  describe("setStrokeEndings / setStrokeGroups", () => {
    it("overrides stroke endings", () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.setStrokeEndings([{ types: ["hane"] }]);
      expect(k.getStrokeEndings()).toEqual([{ types: ["hane"] }]);
    });

    it("overrides stroke groups", () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.setStrokeGroups([[0, 1]]);
      expect(k.getStrokeGroups()).toEqual([[0, 1]]);
    });
  });

  describe("destroy", () => {
    it("removes click listener", () => {
      const onClick = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        onClick,
      });
      k.destroy();
      // After destroy, clicking should not trigger onClick
      container.click();
      expect(onClick).not.toHaveBeenCalled();
    });

    it("clears the rendered SVG from targetEl", () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      expect(container.querySelector("svg")).not.toBeNull();
      k.destroy();
      expect(container.querySelector("svg")).toBeNull();
      expect(container.innerHTML).toBe("");
    });

    it("can be called multiple times safely", () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.destroy();
      expect(() => k.destroy()).not.toThrow();
    });

    it("throws when public methods are called after destroy", async () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.destroy();
      const expectedMessage = "char: instance has been destroyed";
      expect(() => k.start()).toThrow(expectedMessage);
      expect(() => k.animate()).toThrow(expectedMessage);
      expect(() => k.ready()).toThrow(expectedMessage);
      expect(() => k.getStrokeEndings()).toThrow(expectedMessage);
      expect(() => k.getStrokeGroups()).toThrow(expectedMessage);
      expect(() => k.setStrokeEndings([])).toThrow(expectedMessage);
      expect(() => k.setStrokeGroups([[0]])).toThrow(expectedMessage);
      expect(() => k.hideCharacter()).toThrow(expectedMessage);
      expect(() => k.showCharacter()).toThrow(expectedMessage);
      expect(() => k.hideOutline()).toThrow(expectedMessage);
      expect(() => k.showOutline()).toThrow(expectedMessage);
      expect(() => k.getStrokeIndexAtPoint(0, 0)).toThrow(expectedMessage);
      expect(() => k.setStrokeColor(0, "#000")).toThrow(expectedMessage);
      expect(() => k.resetStrokeColor(0)).toThrow(expectedMessage);
      expect(() => k.resetStrokeColors()).toThrow(expectedMessage);
      expect(() => k.getLogicalStrokeCount()).toThrow(expectedMessage);
      expect(() => k.reset()).toThrow(expectedMessage);
      expect(() => k.unmount()).toThrow(expectedMessage);
      expect(() => k.isMounted()).toThrow(expectedMessage);
      expect(() => k.mount(container)).toThrow(expectedMessage);
      expect(() => k.result()).toThrow(expectedMessage);
      // setCharacter and judge are async; synchronous throw becomes a
      // rejected promise.
      await expect(k.setCharacter("い")).rejects.toThrow(expectedMessage);
      await expect(k.judge(0, [])).rejects.toThrow(expectedMessage);
    });
  });

  describe("onClick option", () => {
    it("fires onClick with character and strokeIndex null when the layer is clicked but no stroke hit", () => {
      const onClick = vi.fn();
      createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        onClick,
      });
      // The click listener lives on the Char-owned layerEl, which is the
      // first child of the host container.
      const layerEl = container.firstElementChild as HTMLElement;
      layerEl.click();
      expect(onClick).toHaveBeenCalledWith({
        character: "あ",
        strokeIndex: null,
      });
    });

    it("does not fire onClick when sibling DOM inside the host target is clicked", () => {
      const onClick = vi.fn();
      const sibling = document.createElement("button");
      sibling.textContent = "host action";
      container.appendChild(sibling);
      createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        onClick,
      });
      sibling.click();
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe("setStrokeColor / resetStrokeColor / resetStrokeColors", () => {
    it("setStrokeColor sets stroke color", () => {
      const { k, paths } = createWithStrokePaths();
      k.setStrokeColor(0, "#c00");
      expect(paths[0].style.stroke).toBe("#c00");
    });

    it("setStrokeColor preserves original on repeated calls", () => {
      const { k, paths } = createWithStrokePaths();
      k.setStrokeColor(0, "#c00");
      expect(paths[0].dataset.kakitoriOriginalStroke).toBe("#555");
      k.setStrokeColor(0, "#00f");
      expect(paths[0].dataset.kakitoriOriginalStroke).toBe("#555");
      expect(paths[0].style.stroke).toBe("#00f");
    });

    it("resetStrokeColor restores a single stroke", () => {
      const { k, paths } = createWithStrokePaths();
      k.setStrokeColor(0, "#c00");
      k.resetStrokeColor(0);
      expect(paths[0].style.stroke).toBe("#555");
      expect(paths[0].dataset.kakitoriOriginalStroke).toBeUndefined();
    });

    it("resetStrokeColors restores all strokes", () => {
      const { k, paths } = createWithStrokePaths();
      k.setStrokeColor(0, "#c00");
      k.setStrokeColor(1, "#0c0");
      k.resetStrokeColors();
      expect(paths[0].style.stroke).toBe("#555");
      expect(paths[1].style.stroke).toBe("#555");
      expect(paths[0].dataset.kakitoriOriginalStroke).toBeUndefined();
      expect(paths[1].dataset.kakitoriOriginalStroke).toBeUndefined();
    });
  });

  describe("reset()", () => {
    it("clears stroke colors", () => {
      const { k, paths } = createWithStrokePaths();
      k.setStrokeColor(0, "#c00");
      expect(paths[0].style.stroke).toBe("#c00");

      k.reset();
      expect(paths[0].style.stroke).toBe("#555");
    });

    it("tears down an in-flight animate() overlay", async () => {
      vi.useFakeTimers();
      try {
        const k = createMounted(container, "あ", {
          charDataLoader: mockCharDataLoader,
          configLoader: null,
          strokeAnimationSpeed: 100,
          delayBetweenStrokes: 0,
        });
        await k.ready();

        k.animate();
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }
        const hwSvg = container.querySelector(
          "svg:not(.kakitori-anim):not(.kakitori-grid)",
        ) as SVGSVGElement;
        expect(container.querySelector("svg.kakitori-anim")).not.toBeNull();
        expect(hwSvg.style.visibility).toBe("hidden");

        k.reset();
        expect(container.querySelector("svg.kakitori-anim")).toBeNull();
        expect(hwSvg.style.visibility).toBe("");

        await vi.runAllTimersAsync();
      } finally {
        vi.useRealTimers();
      }
    });

    it("invalidates a queued start() that was waiting on configReady", async () => {
      // Hand-rolled config loader: start() schedules `configReady.then(...)`
      // before this resolves, then reset() must invalidate that queued work
      // so the quiz never lands.
      let resolveConfig: (() => void) | null = null;
      const configLoader = () =>
        new Promise<null>((resolve) => {
          resolveConfig = () => resolve(null);
        });
      const onCorrectStroke = vi.fn();
      const onMistake = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader,
        onCorrectStroke,
        onMistake,
      });

      // configLoader is invoked via Promise.resolve().then(() => loader(...)),
      // so drain a microtask first to let the constructor reach `loader()`.
      await Promise.resolve();

      // Queue a quiz before the config has loaded.
      k.start();
      // Tear down before configReady resolves; the request-seq bump must
      // disqualify start()'s queued continuation.
      k.reset();

      resolveConfig!();
      // Drain the configReady.then callback.
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }

      // No quiz should be running, so neither callback fires; the patched
      // _handleSuccess path should never have been wired up.
      expect(onCorrectStroke).not.toHaveBeenCalled();
      expect(onMistake).not.toHaveBeenCalled();
    });
  });

  describe("showGrid option", () => {
    it("does not draw grid lines when showGrid is omitted", () => {
      createMounted(container, "あ", {
        size: 300,
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const lines = container.querySelectorAll("svg > line");
      expect(lines).toHaveLength(0);
    });

    it("draws cross-hair grid lines when showGrid is true (create)", () => {
      createMounted(container, "あ", {
        size: 300,
        showGrid: true,
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const lines = container.querySelectorAll("svg > line");
      expect(lines).toHaveLength(2);
      // Vertical line spans full size, horizontal line spans full size
      const v = lines[0];
      const h = lines[1];
      expect(v.getAttribute("x1")).toBe("150");
      expect(v.getAttribute("y1")).toBe("0");
      expect(v.getAttribute("y2")).toBe("300");
      expect(h.getAttribute("y1")).toBe("150");
      expect(h.getAttribute("x1")).toBe("0");
      expect(h.getAttribute("x2")).toBe("300");
    });

    it("applies custom GridOptions", () => {
      createMounted(container, "あ", {
        size: 300,
        showGrid: { color: "#aaf", dashArray: "8,4", width: 0.5 },
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const lines = container.querySelectorAll("svg > line");
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.getAttribute("stroke")).toBe("#aaf");
        expect(line.getAttribute("stroke-dasharray")).toBe("8,4");
        expect(line.getAttribute("stroke-width")).toBe("0.5");
      }
    });

    it("sets pointer-events=none on grid lines (does not block hit-test)", () => {
      createMounted(container, "あ", {
        size: 300,
        showGrid: true,
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const lines = container.querySelectorAll("svg > line");
      for (const line of lines) {
        expect(line.getAttribute("pointer-events")).toBe("none");
      }
    });

    it("draws grid lines in render() when showGrid is true", () => {
      char.render(container, "あ", {
        size: 300,
        showGrid: true,
        charDataLoader: mockCharDataLoader,
      });
      const lines = container.querySelectorAll("svg > line");
      expect(lines).toHaveLength(2);
    });

    it("renders the grid lines before the strokes group in render()", () => {
      char.render(container, "あ", {
        size: 300,
        showGrid: true,
        charDataLoader: mockCharDataLoader,
      });
      // SVG paint order is document order, so for the grid to sit *behind*
      // the character strokes, the <line> elements must appear before the
      // strokes <g>. Locking that order here keeps char.create() and
      // char.render() consistent against future refactors.
      const svg = container.querySelector("svg") as SVGSVGElement;
      const children = Array.from(svg.children);
      const lastLineIdx = children.findLastIndex(
        (c) => c.tagName.toLowerCase() === "line",
      );
      const firstGroupIdx = children.findIndex(
        (c) => c.tagName.toLowerCase() === "g",
      );
      expect(lastLineIdx).toBeGreaterThanOrEqual(0);
      expect(firstGroupIdx).toBeGreaterThanOrEqual(0);
      expect(lastLineIdx).toBeLessThan(firstGroupIdx);
    });

    it("marks the grid SVG as aria-hidden so it is not exposed as a separate accessible graphic", () => {
      createMounted(container, "あ", {
        size: 300,
        showGrid: true,
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const gridSvg = container.querySelector("svg.kakitori-grid") as SVGSVGElement;
      expect(gridSvg.getAttribute("aria-hidden")).toBe("true");
    });

    it("keeps pointer-events:none on the grid SVG and its lines so it never blocks hit-testing", () => {
      createMounted(container, "あ", {
        size: 300,
        showGrid: true,
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });

      // The grid sits behind hanzi-writer's SVG today (z-index auto vs hwSvg
      // z-index 1), but pointer-events:none on the SVG itself and on every
      // <line> is the defense-in-depth contract that future re-stacking
      // refactors must keep — otherwise the grid could start intercepting
      // pointer events and break onClick / getStrokeIndexAtPoint.
      // (jsdom can't fully simulate elementFromPoint hit-testing, so we
      // assert the configuration directly instead of triggering a real
      // through-the-grid click.)
      const gridSvg = container.querySelector("svg.kakitori-grid") as SVGSVGElement;
      expect(gridSvg.style.pointerEvents).toBe("none");
      for (const line of gridSvg.querySelectorAll("line")) {
        expect(line.getAttribute("pointer-events")).toBe("none");
      }
    });
  });

  // The previous "monkey patch survival" tests poked hanzi-writer's private
  // _quiz directly via (k as any).hw to verify the patch behavior. Those
  // tests have been split across pure-function suites and a contract test:
  //   - hanziWriterContract.test.ts pins the hanzi-writer private API.
  //   - endingJudgment.test.ts covers computeEndingJudgment routing
  //     (skipped when no config, mid-group skip, etc.).
  //   - patchEndingJudgment.test.ts covers attachEndingJudgmentPatch routing
  //     (advance vs reject based on judgment + strokeEndingAsMiss).
  //   - strokeGroups.test.ts covers logicalStrokesRemaining behavior across
  //     groups, fallback to hanzi-writer's count, etc.

  describe("animate() rapid succession", () => {
    it("animate() cancels an in-flight quiz so the user starts over after お手本", async () => {
      vi.useFakeTimers();
      try {
        const onCorrectStroke = vi.fn();
        const k = createMounted(container, "あ", {
          charDataLoader: mockCharDataLoader,
          configLoader: null,
          strokeAnimationSpeed: 100,
          delayBetweenStrokes: 0,
          onCorrectStroke,
        });
        await k.ready();

        // Start a quiz, then trigger animate() while it's still active.
        k.start();
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }
        // Sanity: pointer listeners are wired up by the quiz.
        const before = container.querySelectorAll("svg").length;
        expect(before).toBeGreaterThan(0);

        k.animate();
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }

        // Quiz teardown must remove the patched _quiz from hanzi-writer; the
        // animate overlay should be on top.
        expect(container.querySelector("svg.kakitori-anim")).not.toBeNull();

        await vi.runAllTimersAsync();
        expect(onCorrectStroke).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("start() cancels an in-flight animate() so the quiz surface is visible immediately", async () => {
      vi.useFakeTimers();
      try {
        const k = createMounted(container, "あ", {
          charDataLoader: mockCharDataLoader,
          configLoader: null,
          strokeAnimationSpeed: 100,
          delayBetweenStrokes: 0,
        });
        await k.ready();
        k.setStrokeGroups([[0], [1]]);

        // Kick off animate; let it claim the overlay and hide hwSvg.
        k.animate();
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }
        const hwSvg = container.querySelector(
          "svg:not(.kakitori-anim):not(.kakitori-grid)",
        ) as SVGSVGElement;
        expect(container.querySelector("svg.kakitori-anim")).not.toBeNull();
        expect(hwSvg.style.visibility).toBe("hidden");

        // Mid-animation start(): overlay must be torn down and hwSvg
        // visibility restored before the quiz takes over.
        k.start();
        expect(container.querySelector("svg.kakitori-anim")).toBeNull();
        expect(hwSvg.style.visibility).toBe("");

        // Drain animate's pending cleanup timer so it doesn't leak.
        await vi.runAllTimersAsync();
        // Even after the timer fires, hwSvg must remain visible — animate's
        // finally block sees activeOverlay !== overlaySvg and skips.
        expect(hwSvg.style.visibility).toBe("");
      } finally {
        vi.useRealTimers();
      }
    });

    it("uses the overlay path even when strokeGroups was never configured", async () => {
      vi.useFakeTimers();
      try {
        const k = createMounted(container, "あ", {
          charDataLoader: mockCharDataLoader,
          configLoader: null,
          strokeAnimationSpeed: 100,
          delayBetweenStrokes: 0,
        });
        await k.ready();

        // No setStrokeGroups call: animate() must still go through the
        // overlay path with identity grouping (one logical stroke per data
        // stroke), not fall back to hanzi-writer's animateCharacter.
        k.animate();
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }
        expect(container.querySelector("svg.kakitori-anim")).not.toBeNull();

        await vi.runAllTimersAsync();
        expect(container.querySelectorAll("svg.kakitori-anim").length).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps at most one .kakitori-anim overlay when animate() is called repeatedly", async () => {
      vi.useFakeTimers();
      try {
        const k = createMounted(container, "あ", {
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
        await k.ready();
        k.setStrokeGroups([[0], [1]]);

        k.animate();
        k.animate();
        k.animate();
        k.animate();

        // Drain microtasks so each queued animateWithGroups() resumes from
        // its getCharacterData() await and synchronously runs the swap that
        // claims activeOverlay; only the last run's overlay should remain.
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }
        const overlays = container.querySelectorAll("svg.kakitori-anim");
        expect(overlays.length).toBeLessThanOrEqual(1);

        // Drain the surviving run's pending cleanup timer so we don't leak
        // a real setTimeout into the next test.
        await vi.runAllTimersAsync();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps the showGrid grid visible while animate() is running", async () => {
      vi.useFakeTimers();
      try {
        const k = createMounted(container, "あ", {
          charDataLoader: mockCharDataLoader,
          configLoader: null,
          showGrid: true,
          strokeAnimationSpeed: 100,
          delayBetweenStrokes: 0,
        });
        await k.ready();
        k.setStrokeGroups([[0], [1]]);

        const gridSvg = container.querySelector("svg.kakitori-grid") as SVGSVGElement | null;
        const hwSvg = container.querySelector(
          "svg:not(.kakitori-anim):not(.kakitori-grid)",
        ) as SVGSVGElement | null;
        expect(gridSvg).not.toBeNull();
        expect(hwSvg).not.toBeNull();
        expect(gridSvg!.style.visibility).not.toBe("hidden");

        k.animate();
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }

        // Mid-animation: hanzi-writer's SVG hides itself but the grid SVG
        // (a separate sibling) must stay visible — that's the whole point of
        // the structural separation.
        expect(hwSvg!.style.visibility).toBe("hidden");
        expect(gridSvg!.isConnected).toBe(true);
        expect(gridSvg!.style.visibility).not.toBe("hidden");
        expect(container.querySelector("svg.kakitori-anim")).not.toBeNull();

        await vi.runAllTimersAsync();

        // After cleanup the grid is still in place and hwSvg is back.
        expect(hwSvg!.style.visibility).toBe("");
        expect(gridSvg!.isConnected).toBe(true);
        expect(container.querySelector("svg.kakitori-anim")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("a stale cleanup timer from a superseded run cannot unhide HanziWriter or remove the new overlay", async () => {
      vi.useFakeTimers();
      try {
        // Tight animation parameters so each run's cleanup timer (totalTime *
        // 1000 + 200ms) fires within ~210ms of fake time. Without this, the
        // setTimeout fires >1.2s after scheduling and the assertions below
        // can't isolate run #1's timer from run #2's.
        const k = createMounted(container, "あ", {
          charDataLoader: mockCharDataLoader,
          configLoader: null,
          strokeAnimationSpeed: 100,
          delayBetweenStrokes: 0,
        });
        await k.ready();
        k.setStrokeGroups([[0], [1]]);

        // Run #1 schedules its cleanup timer at fake-T=0 → fires near T≈210ms.
        k.animate();
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }
        // Advance fake time before run #2 so run #2's timer is scheduled
        // strictly later than run #1's, leaving a window where only run #1's
        // timer has fired.
        await vi.advanceTimersByTimeAsync(100);

        // Run #2 schedules its cleanup timer at fake-T=100 → fires near T≈310ms.
        k.animate();
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }
        const overlay = container.querySelector("svg.kakitori-anim");
        const hw = container.querySelector("svg:not(.kakitori-anim)") as SVGSVGElement | null;
        expect(overlay).not.toBeNull();
        expect(hw).not.toBeNull();
        expect(hw!.style.visibility).toBe("hidden");

        // Advance to fake-T≈250ms: run #1's timer (T≈210) fires; run #2's
        // (T≈310) is still pending. Run #1's finally must observe that
        // activeOverlay is no longer its overlaySvg and leave run #2's state
        // alone.
        await vi.advanceTimersByTimeAsync(150);

        expect(container.querySelector("svg.kakitori-anim")).toBe(overlay);
        expect(hw!.style.visibility).toBe("hidden");

        // Drain run #2's timer: the final state should be clean.
        await vi.runAllTimersAsync();
        expect(container.querySelectorAll("svg.kakitori-anim").length).toBe(0);
        expect(hw!.style.visibility).toBe("");
      } finally {
        vi.useRealTimers();
      }
    });

    it("DOM-dependent APIs still work after setCharacter()", async () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();

      // Switch the character; the cached hwSvg reference must remain valid
      // for the DOM-dependent APIs that reuse it (animate, getStrokePaths,
      // getStrokeIndexAtPoint).
      await k.setCharacter("い");

      expect(() => k.getStrokeIndexAtPoint(0, 0)).not.toThrow();
      expect(k.getLogicalStrokeCount()).toBeGreaterThan(0);

      vi.useFakeTimers();
      try {
        k.setStrokeGroups([[0], [1]]);
        k.animate();
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }
        // If the cached hwSvg had gone stale, animate would short-circuit at
        // its `if (!hwSvg) return` and the overlay would never appear.
        expect(container.querySelector("svg.kakitori-anim")).not.toBeNull();
        // Stronger check: the *live* hanzi-writer SVG in the DOM must be the
        // one being hidden during animation. If the cached reference had been
        // detached by a hypothetical setCharacter() that swaps out the root
        // <svg>, animate() would set visibility on the orphan and the live
        // SVG would stay visible — this assertion would fail.
        const liveHwSvg = container.querySelector(
          "svg:not(.kakitori-anim):not(.kakitori-grid)",
        ) as SVGSVGElement;
        expect(liveHwSvg.style.visibility).toBe("hidden");
        await vi.runAllTimersAsync();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("computeMedianPathLength", () => {
    it("returns 0 for empty or single-point arrays", () => {
      expect(computeMedianPathLength([])).toBe(0);
      expect(computeMedianPathLength([{ x: 0, y: 0 }])).toBe(0);
    });

    it("computes total euclidean distance", () => {
      // 3-4-5 right triangle: each segment = 5
      expect(
        computeMedianPathLength([
          { x: 0, y: 0 },
          { x: 3, y: 4 },
        ]),
      ).toBe(5);
    });

    it("sums multiple segments", () => {
      expect(
        computeMedianPathLength([
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ]),
      ).toBe(20);
    });

    it("longer strokes return larger lengths", () => {
      const short = computeMedianPathLength([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]);
      const long = computeMedianPathLength([
        { x: 0, y: 0 },
        { x: 500, y: 0 },
      ]);
      expect(long).toBeGreaterThan(short);
    });
  });

  describe("mount lifecycle", () => {
    it("create() leaves the instance unmounted", () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      expect(k.isMounted()).toBe(false);
      expect(container.querySelector("svg")).toBeNull();
    });

    it("mount() returns the same Char for chaining", () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const chained = k.mount(container);
      expect(chained).toBe(k);
      expect(k.isMounted()).toBe(true);
      expect(container.querySelector("svg")).not.toBeNull();
    });

    it("unmount() returns the same Char and clears the SVG", () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.mount(container);
      const chained = k.unmount();
      expect(chained).toBe(k);
      expect(k.isMounted()).toBe(false);
      expect(container.innerHTML).toBe("");
    });

    it("a second mount() unmounts the previous target", () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const otherContainer = document.createElement("div");
      document.body.appendChild(otherContainer);
      try {
        k.mount(container);
        expect(container.querySelector("svg")).not.toBeNull();
        k.mount(otherContainer);
        expect(container.innerHTML).toBe("");
        expect(otherContainer.querySelector("svg")).not.toBeNull();
      } finally {
        otherContainer.remove();
      }
    });

    it("destroy() preserves sibling DOM the host added to the target", () => {
      const sibling = document.createElement("p");
      sibling.textContent = "host content";
      container.appendChild(sibling);

      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.mount(container);
      expect(container.contains(sibling)).toBe(true);

      k.destroy();
      expect(container.contains(sibling)).toBe(true);
      expect(container.querySelector("svg")).toBeNull();
    });

    it("unmount() tears down in-flight animate / quiz so callbacks do not leak", async () => {
      vi.useFakeTimers();
      try {
        const onCorrectStroke = vi.fn();
        const k = char.create("あ", {
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
        k.mount(container, {
          strokeAnimationSpeed: 100,
          delayBetweenStrokes: 0,
          onCorrectStroke,
        });
        // Kick off an animate, let it claim the overlay.
        k.animate();
        for (let i = 0; i < 20; i++) {
          await Promise.resolve();
        }
        expect(container.querySelector("svg.kakitori-anim")).not.toBeNull();

        // Unmount mid-animation; the overlay must be torn down with the
        // layer (no leftover offscreen overlay floating around).
        k.unmount();
        expect(document.querySelector("svg.kakitori-anim")).toBeNull();

        // A stroke success arriving after unmount (via the still-pending
        // setTimeout from animate) should not re-emerge as a callback.
        await vi.runAllTimersAsync();
        expect(onCorrectStroke).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("unmount() removes only what mount() added; sibling DOM stays intact", () => {
      // Hosts often surround the target with their own DOM (labels,
      // overlays). unmount() must not wipe those — it should drop only
      // the layer the Char appended.
      const sibling = document.createElement("p");
      sibling.textContent = "host content";
      container.appendChild(sibling);

      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.mount(container);
      expect(container.querySelector("svg")).not.toBeNull();
      expect(container.contains(sibling)).toBe(true);

      k.unmount();
      expect(container.contains(sibling)).toBe(true);
      expect(container.querySelector("svg")).toBeNull();
    });

    it("DOM-bound methods throw before mount()", () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const expectedMessage = "char: not mounted";
      expect(() => k.start()).toThrow(expectedMessage);
      expect(() => k.animate()).toThrow(expectedMessage);
      expect(() => k.reset()).toThrow(expectedMessage);
      expect(() => k.hideCharacter()).toThrow(expectedMessage);
      expect(() => k.showCharacter()).toThrow(expectedMessage);
      expect(() => k.hideOutline()).toThrow(expectedMessage);
      expect(() => k.showOutline()).toThrow(expectedMessage);
      expect(() => k.setStrokeColor(0, "#000")).toThrow(expectedMessage);
      expect(() => k.resetStrokeColor(0)).toThrow(expectedMessage);
      expect(() => k.resetStrokeColors()).toThrow(expectedMessage);
      expect(() => k.getStrokeIndexAtPoint(0, 0)).toThrow(expectedMessage);
    });

    it("getLogicalStrokeCount works headless when strokeGroups is configured", () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        strokeGroups: [[0], [1]],
      });
      expect(k.getLogicalStrokeCount()).toBe(2);
    });

    it("destroy() unmounts the instance and is idempotent", () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.mount(container);
      k.destroy();
      expect(container.innerHTML).toBe("");
      expect(() => k.destroy()).not.toThrow();
    });

    it("mount() throws after judge() has been called on the same Char", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      await k.judge(0, [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ]);
      expect(() => k.mount(container)).toThrow("after judge");
    });

    it("judge() throws on a mounted instance", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.mount(container);
      await expect(
        k.judge(0, [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ]),
      ).rejects.toThrow("not supported on a mounted instance");
    });
  });

  describe("judge() / result()", () => {
    it("returns matched=true for a stroke that traces hanzi-writer's median", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      // mockCharData stroke 0 median: [[0,0], [100,100]]; trace it densely
      // enough to satisfy hanzi-writer's matcher.
      const trace = [
        { x: 0, y: 0 },
        { x: 25, y: 25 },
        { x: 50, y: 50 },
        { x: 75, y: 75 },
        { x: 100, y: 100 },
      ];
      const r = await k.judge(0, trace);
      expect(r.matched).toBe(true);
      expect(r.similarity).toBeGreaterThan(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    });

    it("returns matched=false for a stroke far from the expected median", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const r = await k.judge(0, [
        { x: 0, y: 0 },
        { x: -500, y: -500 },
      ]);
      expect(r.matched).toBe(false);
    });

    it("similarity is 0 once the average distance exceeds the matcher threshold", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const r = await k.judge(0, [
        { x: 9999, y: 9999 },
        { x: 10000, y: 10000 },
      ]);
      expect(r.similarity).toBe(0);
    });

    it("result() exposes the cumulative per-stroke matches", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const goodTrace0 = [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 100 },
      ];
      const goodTrace1 = [
        { x: 200, y: 200 },
        { x: 250, y: 250 },
        { x: 300, y: 300 },
      ];
      await k.judge(0, goodTrace0);
      await k.judge(1, goodTrace1);
      const res = k.result();
      expect(res.perStroke).toHaveLength(2);
      expect(res.perStroke[0].matched).toBe(true);
      expect(res.perStroke[1].matched).toBe(true);
      expect(res.matched).toBe(true);
    });

    it("result() reports matched=false when at least one judged stroke missed", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      await k.judge(0, [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 100 },
      ]);
      await k.judge(1, [
        { x: -999, y: -999 },
        { x: -888, y: -888 },
      ]);
      const res = k.result();
      expect(res.matched).toBe(false);
    });

    it("rejects negative or non-integer strokeNum", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      await expect(k.judge(-1, [])).rejects.toThrow("non-negative integer");
      await expect(k.judge(0.5, [])).rejects.toThrow("non-negative integer");
    });

    it("propagates a charDataLoader failure as a real error from judge()", async () => {
      const failingLoader: CharDataLoaderFn = (_char, _onLoad, onError) => {
        onError(new Error("load failed: 永"));
      };
      const k = char.create("永", {
        charDataLoader: failingLoader,
        configLoader: null,
      });
      // The exact error message hanzi-writer surfaces here is not stable
      // across versions, so just assert that judge() rejects (rather than
      // hanging on the polling timeout) when the underlying loader fails.
      await expect(
        k.judge(0, [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]),
      ).rejects.toThrow();
    });

    it("concurrent judge() calls share a single offscreen container", async () => {
      const offscreenBefore = document.body.querySelectorAll(
        "div[aria-hidden=\"true\"]",
      ).length;
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const trace = [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 100 },
      ];
      // Without memoization, each Promise.all entry would race ensureJudger
      // and append its own offscreen container before any awaited step
      // resolves; the losers leak. Verify only one new offscreen container
      // ever lands on document.body.
      await Promise.all([
        k.judge(0, trace),
        k.judge(0, trace),
        k.judge(0, trace),
      ]);
      const offscreenAfter = document.body.querySelectorAll(
        "div[aria-hidden=\"true\"]",
      ).length;
      expect(offscreenAfter - offscreenBefore).toBe(1);
      k.destroy();
    });

    it("sourceBox projects screen-space points into hanzi-writer internal coords", async () => {
      // mockCharData stroke 0 median is [(0, 0), (100, 100)] in internal
      // coords (Y up). The same shape on a 900x900 source square (Y down,
      // origin top-left) would draw from (0, 900) to (100, 800). With
      // sourceBox set, judge() must flip Y and pass through unchanged in X
      // (since size matches HANZI_COORD_SIZE).
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const sourceBox = { x: 0, y: 0, size: 900 };
      const trace = [
        { x: 0, y: 900 },
        { x: 25, y: 875 },
        { x: 50, y: 850 },
        { x: 75, y: 825 },
        { x: 100, y: 800 },
      ];
      const r = await k.judge(0, trace, { sourceBox });
      expect(r.matched).toBe(true);
      expect(r.similarity).toBeGreaterThan(0);
    });

    it("sourceBox preserves the spatial relationship between strokes", async () => {
      // Both strokes drawn at their canonical (internal) positions but
      // expressed in screen coords on a 900x900 square. Mock medians are
      // [(0,0)-(100,100)] for stroke 0 and [(200,200)-(300,300)] for
      // stroke 1; both must match when fed through the same sourceBox.
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const sourceBox = { x: 0, y: 0, size: 900 };
      const stroke0 = [
        { x: 0, y: 900 },
        { x: 50, y: 850 },
        { x: 100, y: 800 },
      ];
      const stroke1 = [
        { x: 200, y: 700 },
        { x: 250, y: 650 },
        { x: 300, y: 600 },
      ];
      const r0 = await k.judge(0, stroke0, { sourceBox });
      const r1 = await k.judge(1, stroke1, { sourceBox });
      expect(r0.matched).toBe(true);
      expect(r1.matched).toBe(true);
    });

    it("sourceBox.size must be positive and finite", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      await expect(
        k.judge(0, [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ], { sourceBox: { x: 0, y: 0, size: 0 } }),
      ).rejects.toThrow("sourceBox.size must be a positive finite number");
      await expect(
        k.judge(0, [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ], { sourceBox: { x: 0, y: 0, size: Number.POSITIVE_INFINITY } }),
      ).rejects.toThrow("sourceBox.size must be a positive finite number");
    });
  });
});
