import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  char,
  computeMedianPathLength,
  computeRetainedStrokeAttrs,
  displayPxToHanziWriterDrawingWidth,
  projectToInternal,
} from "./char.js";
import { DEFAULT_DRAWING_WIDTH, HANZI_PRESCALED_SIZE } from "./constants.js";
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
    // With `showGrid` defaulting to true, the layer holds two SVGs:
    // the grid (lines only, no defs) and hanzi-writer's (carries
    // `<defs>`). Pick the hw one so the stroke-color manipulation
    // hits the real character paths.
    const allSvgs = Array.from(container.querySelectorAll("svg"));
    const hwSvg = (allSvgs.find((s) => s.querySelector(":scope > defs")) ??
      allSvgs[allSvgs.length - 1]) as SVGSVGElement;
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

    it("throws when strokeEndingStrictness is below 0", () => {
      expect(() => {
        char.create("あ", {
          charDataLoader: mockCharDataLoader,
          configLoader: null,
          strokeEndingStrictness: -0.1,
        });
      }).toThrow("strokeEndingStrictness must be in [0, 1]");
    });

    it("throws when strokeEndingStrictness is above 1", () => {
      expect(() => {
        char.create("あ", {
          charDataLoader: mockCharDataLoader,
          configLoader: null,
          strokeEndingStrictness: 1.5,
        });
      }).toThrow("strokeEndingStrictness must be in [0, 1]");
    });

    it("throws when strokeEndingStrictness is NaN", () => {
      expect(() => {
        char.create("あ", {
          charDataLoader: mockCharDataLoader,
          configLoader: null,
          strokeEndingStrictness: Number.NaN,
        });
      }).toThrow("strokeEndingStrictness must be in [0, 1]");
    });
  });

  describe("retainStrokes option", () => {
    it("does not create the retained-strokes overlay until a stroke is appended", () => {
      createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        retainStrokes: true,
      });
      // Lazy: the overlay only materializes once `appendRetainedStroke`
      // fires (from an accepted stroke). Mount alone shouldn't add it.
      expect(container.querySelector("svg.kakitori-retained")).toBeNull();
    });

    it("leaves the retain overlay absent when the option is off", () => {
      createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        retainStrokes: false,
      });
      expect(container.querySelector("svg.kakitori-retained")).toBeNull();
    });

    it("reset() / undo() / start() do not crash before any stroke is retained", () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        retainStrokes: true,
      });
      expect(() => k.reset()).not.toThrow();
      expect(() => k.undo()).not.toThrow();
      expect(() => k.start()).not.toThrow();
    });
  });

  describe("showAcceptedStroke option", () => {
    // hanzi-writer renders three sibling groups inside its outer <g>:
    // [0] outline (dashed reference), [1] main (the user's accepted ink),
    // [2] highlight. The `main` group is what `strokeColor` paints.
    function mainGroupStrokes(root: HTMLElement): string[] {
      const groups = root.querySelectorAll("svg > g > g");
      const mainPaths = groups[1]?.querySelectorAll("path");
      return Array.from(mainPaths ?? []).map((p) => p.getAttribute("stroke") ?? "");
    }

    // ready() resolves once character data has loaded, but hanzi-writer's
    // internal RenderState commit happens on the next microtask after
    // that. Flushing one macrotask gives the SVG paths their final
    // `stroke` attribute before we read it.
    async function paintReady(k: { ready(): Promise<unknown> }): Promise<void> {
      await k.ready();
      await new Promise((r) => setTimeout(r, 0));
    }

    it("paints accepted strokes with the default color when option is unset", async () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await paintReady(k);
      const strokes = mainGroupStrokes(container);
      expect(strokes.length).toBeGreaterThan(0);
      for (const s of strokes) {
        // Default hanzi-writer color (#555 = rgba(85,85,85,1)).
        expect(s).toMatch(/rgba\(85,\s*85,\s*85,\s*1\)/);
      }
    });

    it("paints accepted strokes as fully transparent when showAcceptedStroke is false", async () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        showAcceptedStroke: false,
      });
      await paintReady(k);
      const strokes = mainGroupStrokes(container);
      expect(strokes.length).toBeGreaterThan(0);
      for (const s of strokes) {
        expect(s).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);
      }
    });

    it("lets an explicit strokeColor win over showAcceptedStroke:false", async () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        showAcceptedStroke: false,
        strokeColor: "#abcdef",
      });
      await paintReady(k);
      const strokes = mainGroupStrokes(container);
      expect(strokes.length).toBeGreaterThan(0);
      for (const s of strokes) {
        // #abcdef = rgba(171, 205, 239, 1)
        expect(s).toMatch(/rgba\(171,\s*205,\s*239,\s*1\)/);
      }
    });

    it("leaves the default in place when showAcceptedStroke is explicitly true", async () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        showAcceptedStroke: true,
      });
      await paintReady(k);
      const strokes = mainGroupStrokes(container);
      expect(strokes.length).toBeGreaterThan(0);
      for (const s of strokes) {
        expect(s).toMatch(/rgba\(85,\s*85,\s*85,\s*1\)/);
      }
    });
  });

  describe("correction: per-char", () => {
    function drawStroke(
      el: HTMLElement,
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
      const last = points[points.length - 1];
      dispatch("pointerup", last[0], last[1]);
    }

    function getWriterLayer(root: HTMLElement): HTMLElement {
      const svg = root.querySelector("svg");
      if (!svg) {
        throw new Error("test setup: hanzi-writer SVG not found");
      }
      return svg.parentElement as HTMLElement;
    }

    it("defers per-stroke dispatch until every stroke of the char is drawn", async () => {
      // Sanity check on the deferral: while only some of the strokes
      // have landed, neither onCorrectStroke nor onMistake fires.
      // Whether onComplete eventually fires depends on whether the
      // user got the char right — per-char retries NG attempts in
      // place, so onComplete only lands on an OK attempt. This test
      // therefore checks the deferral, not the eventual completion.
      const onCorrect = vi.fn();
      const onMistake = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "per-char",
        onCorrectStroke: onCorrect,
        onMistake,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      drawStroke(layer, [[10, 10], [40, 40], [70, 70]]);
      await new Promise((r) => setTimeout(r, 0));
      expect(onCorrect).not.toHaveBeenCalled();
      expect(onMistake).not.toHaveBeenCalled();

      // Second pointer cycle completes the character (mockCharData has 2 strokes).
      drawStroke(layer, [[120, 120], [180, 180], [240, 240]]);
      // finalizePerChar is async (checker init + per-stroke awaits).
      await new Promise((r) => setTimeout(r, 50));

      // Every captured stroke dispatches through either onCorrectStroke
      // (matched: true) or onMistake (matched: false) so consumers can
      // filter by callback name. Total dispatches == stroke count.
      expect(onCorrect.mock.calls.length + onMistake.mock.calls.length).toBe(2);
    });

    it("dispatches per-stroke verdicts through onMistake when the matcher rejects", async () => {
      // In per-char mode, mismatched strokes fire onMistake (matching
      // the per-stroke callback contract), even though the user is
      // never interrupted mid-character. mockCharData's strokes are
      // diagonals; a single horizontal sweep won't satisfy the matcher,
      // so onMistake must fire when check finalizes. onComplete stays
      // silent: a fully-NG char re-arms for retry, not completion.
      const onCorrect = vi.fn();
      const onMistake = vi.fn();
      const onComplete = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "per-char",
        onCorrectStroke: onCorrect,
        onMistake,
        onComplete,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      drawStroke(layer, [[10, 60], [40, 60], [70, 60]]);
      drawStroke(layer, [[10, 80], [40, 80], [70, 80]]);
      await new Promise((r) => setTimeout(r, 50));

      expect(onComplete).not.toHaveBeenCalled();
      // onMistake must fire at least once: at least one of the two
      // horizontal strokes can't match the diagonals.
      expect(onMistake.mock.calls.length).toBeGreaterThan(0);
      // Every per-char dispatch is exclusive: a stroke is EITHER
      // onCorrectStroke or onMistake, never both, so the totals add up
      // to the stroke count.
      expect(onCorrect.mock.calls.length + onMistake.mock.calls.length).toBe(2);
    });

    it("does not bridge to hanzi-writer's quiz mid-stroke (no early onMistake)", async () => {
      // The contract is "no mid-stroke rejection in per-char". Verify
      // that onMistake doesn't fire while the user is still mid-draw —
      // check only happens after the FULL character is captured.
      const onMistake = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "per-char",
        onMistake,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      // Only one of two strokes drawn: check must NOT have run yet,
      // so onMistake stays untouched even though the stroke is wrong.
      drawStroke(layer, [[5, 5], [5, 6]]);
      await new Promise((r) => setTimeout(r, 50));
      expect(onMistake).not.toHaveBeenCalled();
    });

    it("ignores zero-distance taps and waits for genuine strokes", async () => {
      const onComplete = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "per-char",
        onComplete,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      // Two taps with no movement: should be discarded, not counted as
      // strokes; otherwise onComplete would fire after the second tap.
      drawStroke(layer, [[10, 10]]);
      drawStroke(layer, [[20, 20]]);
      await new Promise((r) => setTimeout(r, 50));
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("swallows clicks across an NG-retry cycle (quizActive stays true)", async () => {
      // Browsers dispatch a synthetic `click` after every `pointerup`,
      // including the `pointerup` that completes the last stroke of a
      // per-char cycle. With NG-retry in effect, `quizActive` stays
      // true across the rejected attempt and the existing `boundOnClick`
      // gate (not the post-finalize guard) keeps onClick silent.
      const onClick = vi.fn();
      const onCharRejected = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "deferred",
        onClick,
        onCharRejected,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      // Horizontal strokes against mockCharData's diagonal medians is
      // an unambiguous NG drive — robust against matcher heuristic
      // tweaks that might otherwise let diagonal user strokes squeak
      // past the threshold.
      drawStroke(layer, [[10, 60], [40, 60], [70, 60]]);
      drawStroke(layer, [[10, 80], [40, 80], [70, 80]]);
      k.check();
      await new Promise((r) => setTimeout(r, 50));
      expect(onCharRejected).toHaveBeenCalledTimes(1);

      layer.click();
      expect(onClick).not.toHaveBeenCalled();
    });

    it("wipes retained ink and re-arms the cycle when the char is NG", async () => {
      // Mirror per-stroke's "NG strokes never accumulate" UX at char
      // granularity: if any stroke is rejected, wipe every polyline
      // for the char AND keep the cycle armed so the user can rewrite
      // the same character. onComplete must NOT fire — the char isn't
      // done until an OK attempt lands.
      const onComplete = vi.fn();
      const onMistake = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "per-char",
        retainStrokes: true,
        onComplete,
        onMistake,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      // Two horizontal strokes won't match mockCharData's diagonals,
      // so the char is NG.
      drawStroke(layer, [[10, 60], [40, 60], [70, 60]]);
      drawStroke(layer, [[10, 80], [40, 80], [70, 80]]);
      await new Promise((r) => setTimeout(r, 50));

      // NG attempt: onMistake fires at least once, onComplete stays
      // silent, retained polylines wiped, ready for the next attempt.
      expect(onMistake.mock.calls.length).toBeGreaterThan(0);
      expect(onComplete).not.toHaveBeenCalled();
      const polylines = container.querySelectorAll("svg.kakitori-retained polyline");
      expect(polylines.length).toBe(0);

      // The cycle is re-armed: dispatching another two strokes goes
      // through finalize again (onMistake count grows).
      const beforeRetry = onMistake.mock.calls.length;
      drawStroke(layer, [[10, 100], [40, 100], [70, 100]], 2);
      drawStroke(layer, [[10, 120], [40, 120], [70, 120]], 3);
      await new Promise((r) => setTimeout(r, 50));
      expect(onMistake.mock.calls.length).toBeGreaterThan(beforeRetry);
    });

  });

  describe("correction: deferred", () => {
    function drawStroke(
      el: HTMLElement,
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
      const last = points[points.length - 1];
      dispatch("pointerup", last[0], last[1]);
    }

    function getWriterLayer(root: HTMLElement): HTMLElement {
      const svg = root.querySelector("svg");
      if (!svg) {
        throw new Error("test setup: hanzi-writer SVG not found");
      }
      return svg.parentElement as HTMLElement;
    }

    it("fires onCharCaptured (not onComplete) when all strokes are drawn", async () => {
      const onCharCaptured = vi.fn();
      const onComplete = vi.fn();
      const onCorrect = vi.fn();
      const onMistake = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "deferred",
        onCharCaptured,
        onComplete,
        onCorrectStroke: onCorrect,
        onMistake,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      drawStroke(layer, [[10, 10], [40, 40], [70, 70]]);
      drawStroke(layer, [[120, 120], [180, 180], [240, 240]]);

      // Deferred: onCharCaptured fires immediately, the rest stay
      // silent until check() runs.
      expect(onCharCaptured).toHaveBeenCalledTimes(1);
      expect(onComplete).not.toHaveBeenCalled();
      expect(onCorrect).not.toHaveBeenCalled();
      expect(onMistake).not.toHaveBeenCalled();
      // Captures arg has one entry per stroke (mockCharData has 2).
      const captures = onCharCaptured.mock.calls[0][0] as ReadonlyArray<
        ReadonlyArray<{ x: number; y: number; t: number }>
      >;
      expect(captures).toHaveLength(2);
    });

    it("runs correction (firing per-stroke callbacks) when Char.check() is called", async () => {
      // Diagonal mockCharData vs horizontal user strokes → NG verdict.
      // Deferred mode mirrors per-char's in-place retry on NG: per-stroke
      // verdicts dispatch (onCorrect / onMistake totals to strokeCount),
      // onCharRejected fires, and onComplete is held back for the
      // eventual OK round.
      const onCharCaptured = vi.fn();
      const onCharRejected = vi.fn();
      const onComplete = vi.fn();
      const onCorrect = vi.fn();
      const onMistake = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "deferred",
        onCharCaptured,
        onCharRejected,
        onComplete,
        onCorrectStroke: onCorrect,
        onMistake,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      // Horizontal strokes against the diagonal mockCharData medians:
      // an unambiguous NG drive (robust against any matcher
      // heuristic / normalization tweak).
      drawStroke(layer, [[10, 60], [40, 60], [70, 60]]);
      drawStroke(layer, [[10, 80], [40, 80], [70, 80]]);

      // Now trigger correction.
      k.check();
      await new Promise((r) => setTimeout(r, 50));

      // Each captured stroke produces exactly one callback (correct or
      // mistake) — total dispatches == stroke count.
      expect(onCorrect.mock.calls.length + onMistake.mock.calls.length).toBe(2);
      expect(onCharRejected).toHaveBeenCalledTimes(1);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("maxRetries: 0 commits as failed on the first NG attempt", async () => {
      // No retry budget — the first deferred check() that lands NG
      // should NOT re-arm; instead onComplete fires with
      // matched: false and attempts: 1 so the cell / block / page
      // commit chain can settle on a final NG outcome.
      const onCharRejected = vi.fn();
      const onComplete = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "deferred",
        maxRetries: 0,
        onCharRejected,
        onComplete,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      drawStroke(layer, [[10, 60], [40, 60], [70, 60]]);
      drawStroke(layer, [[10, 80], [40, 80], [70, 80]]);
      k.check();
      await new Promise((r) => setTimeout(r, 50));

      expect(onCharRejected).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledTimes(1);
      const data = onComplete.mock.calls[0][0];
      expect(data.matched).toBe(false);
      expect(data.attempts).toBe(1);
    });

    it("maxRetries: 1 allows one retry then commits as failed on the second NG", async () => {
      // Budget of 1 retry. Round 1 NG → onCharRejected (re-arm).
      // Round 2 NG → onComplete with matched: false, attempts: 2.
      const onCharRejected = vi.fn();
      const onComplete = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "deferred",
        maxRetries: 1,
        onCharRejected,
        onComplete,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      // First attempt — NG.
      drawStroke(layer, [[10, 60], [40, 60], [70, 60]], 1);
      drawStroke(layer, [[10, 80], [40, 80], [70, 80]], 2);
      k.check();
      await new Promise((r) => setTimeout(r, 50));
      expect(onCharRejected).toHaveBeenCalledTimes(1);
      expect(onCharRejected.mock.calls[0][0].attempts).toBe(1);
      expect(onComplete).not.toHaveBeenCalled();

      // Second attempt — also NG, but budget exhausted so onComplete
      // fires.
      drawStroke(layer, [[10, 60], [40, 60], [70, 60]], 3);
      drawStroke(layer, [[10, 80], [40, 80], [70, 80]], 4);
      k.check();
      await new Promise((r) => setTimeout(r, 50));
      expect(onCharRejected).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledTimes(1);
      const data = onComplete.mock.calls[0][0];
      expect(data.matched).toBe(false);
      expect(data.attempts).toBe(2);
    });

    it("re-arms the capture cycle after an NG check so the user can retry", async () => {
      // After Char.check() lands NG, the cycle restarts: the user can
      // draw another N strokes, that batch surfaces through
      // onCharCaptured again, and a second Char.check() runs another
      // round of correction. The deferred retry path stays cleanly
      // separated round-by-round (no leaked state from the previous
      // attempt).
      const onCharCaptured = vi.fn();
      const onCharRejected = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "deferred",
        onCharCaptured,
        onCharRejected,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      // Round 1: full capture + NG check + rejection signal.
      drawStroke(layer, [[10, 10], [40, 40], [70, 70]]);
      drawStroke(layer, [[120, 120], [180, 180], [240, 240]]);
      k.check();
      await new Promise((r) => setTimeout(r, 50));
      expect(onCharRejected).toHaveBeenCalledTimes(1);

      // Round 2: cycle re-armed, user draws again, captured signal
      // fires again. The character ink overlay is cleared between
      // rounds.
      const polylinesBetweenRounds = container.querySelectorAll(
        "svg.kakitori-retained polyline",
      );
      expect(polylinesBetweenRounds.length).toBe(0);
      drawStroke(layer, [[10, 10], [40, 40], [70, 70]], 99);
      drawStroke(layer, [[120, 120], [180, 180], [240, 240]], 100);
      await new Promise((r) => setTimeout(r, 0));
      expect(onCharCaptured).toHaveBeenCalledTimes(2);
    });

    it("Char.check() is a no-op (logs) when there is nothing buffered", async () => {
      const log = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "deferred",
        logger: log,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      // No strokes drawn — buffer is empty.
      k.check();
      const messages = log.mock.calls.map((c) => c[0]);
      expect(messages.some((m) => m.includes("no buffered captures"))).toBe(true);
    });

    it("reset() drops the buffered captures so a stale check() becomes a no-op", async () => {
      const onComplete = vi.fn();
      const log = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        correction: "deferred",
        onComplete,
        logger: log,
      });
      await k.ready();
      k.start();
      await new Promise((r) => setTimeout(r, 0));

      const layer = getWriterLayer(container);
      drawStroke(layer, [[10, 10], [40, 40], [70, 70]]);
      drawStroke(layer, [[120, 120], [180, 180], [240, 240]]);

      k.reset();
      k.check();
      await new Promise((r) => setTimeout(r, 50));

      expect(onComplete).not.toHaveBeenCalled();
      const messages = log.mock.calls.map((c) => c[0]);
      expect(messages.some((m) => m.includes("no buffered captures"))).toBe(true);
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

    it("places y=HANZI_Y_MAX at padding and y=HANZI_Y_MIN at size-padding", () => {
      // Verifies the baseline-offset transform so hanzi-writer's
      // asymmetric source Y range [-124, 900] spans the inner box: top
      // of character (y=900) lands at the inner top (= padding), and
      // descender bottom (y=-124) lands at the inner bottom (=
      // size - padding).
      const size = 300;
      const padding = 20;
      char.render(container, "あ", {
        size,
        padding,
        charDataLoader: mockCharDataLoader,
      });
      const g = container.querySelector("svg g") as SVGGElement;
      const transform = g.getAttribute("transform") ?? "";
      // Transform is of the form `translate(tx, ty) scale(s, -s)` — parse it
      // out arithmetically instead of leaning on jsdom's matrix consolidation
      // (which doesn't run layout, so getCTM() returns the identity).
      const m = transform.match(
        /translate\(([\d.eE+-]+),\s*([\d.eE+-]+)\)\s*scale\(([\d.eE+-]+),\s*([\d.eE+-]+)\)/,
      );
      expect(m).not.toBeNull();
      const [tx, ty, sx, sy] = [m![1], m![2], m![3], m![4]].map(Number);
      // Map a path point (x, y) through `translate(tx, ty) scale(sx, sy)`.
      const apply = (x: number, y: number) => ({
        x: tx + x * sx,
        y: ty + y * sy,
      });
      const topPoint = apply(0, 900); // character top
      const bottomPoint = apply(0, -124); // descender bottom
      expect(topPoint.y).toBeCloseTo(padding);
      expect(bottomPoint.y).toBeCloseTo(size - padding);
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
      // setCharacter and check are async; synchronous throw becomes a
      // rejected promise.
      await expect(k.setCharacter("い")).rejects.toThrow(expectedMessage);
      await expect(k.checkStroke(0, [])).rejects.toThrow(expectedMessage);
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

    it("does not fire onClick while a quiz / per-char cycle is active", async () => {
      // The trailing click event of a drawn stroke (browsers fire one
      // unless the gesture is a clear drag) must not bleed into
      // onClick — otherwise consumers using onClick for
      // click-to-inspect (e.g. setStrokeColor) would recolor the just
      // -accepted stroke and clobber its strokeColor / showAcceptedStroke
      // contract. Start a quiz, then click the layer and verify the
      // callback stays silent.
      const onClick = vi.fn();
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        onClick,
      });
      await k.ready();
      k.start();
      // start() schedules startQuiz via configReady.then, so flush one
      // microtask before checking the gate.
      await new Promise((r) => setTimeout(r, 0));

      const layerEl = container.firstElementChild as HTMLElement;
      layerEl.click();
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

  describe("undo()", () => {
    it("clears stroke colors like reset()", async () => {
      const { k, paths } = createWithStrokePaths();
      await k.ready();
      k.setStrokeColor(0, "#c00");
      expect(paths[0].style.stroke).toBe("#c00");

      k.undo();
      expect(paths[0].style.stroke).toBe("#555");
    });

    it("is safe to call before, during, and after start()", async () => {
      const k = createMounted(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      // Pre-start: undo behaves like reset().
      expect(() => k.undo()).not.toThrow();

      // Arm the quiz, then undo: must re-arm, observable via the queued
      // startQuiz draining without throwing.
      k.start();
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
      expect(() => k.undo()).not.toThrow();
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }

      // After a fresh reset() the armed flag is cleared, so a subsequent
      // undo() does not re-arm — verify by checking it still doesn't
      // throw and that reset's stroke-color cleanup persists.
      k.reset();
      expect(() => k.undo()).not.toThrow();
    });
  });

  describe("showGrid option", () => {
    it("draws the cross-grid when showGrid is omitted (defaults to true)", () => {
      // Aligned with the block / page layer's own `showGrid` default;
      // a host that drops the option in `char.mount()` should see the
      // same grid those layers render by default.
      createMounted(container, "あ", {
        size: 300,
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const lines = container.querySelectorAll("svg > line");
      expect(lines).toHaveLength(2);
    });

    it("does not draw grid lines when showGrid is false", () => {
      createMounted(container, "あ", {
        size: 300,
        showGrid: false,
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
  //   - endingCheck.test.ts covers computeEndingCheck routing
  //     (skipped when no config, mid-group skip, etc.).
  //   - patchEndingCheck.test.ts covers attachEndingCheckPatch routing
  //     (advance vs reject based on check + strokeEndingAsMiss).
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
        // With showGrid defaulting to true the layer holds two
        // non-anim SVGs (grid + hanzi-writer). Pick the hw one via
        // its `<defs>` marker.
        const hw = Array.from(
          container.querySelectorAll<SVGSVGElement>(
            "svg:not(.kakitori-anim)",
          ),
        ).find((s) => s.querySelector(":scope > defs")) ?? null;
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

    it("mount() throws after check() has been called on the same Char", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      await k.checkStroke(0, [
        { x: 0, y: 0, t: 0 },
        { x: 100, y: 100, t: 0 },
      ]);
      expect(() => k.mount(container)).toThrow("after check");
    });

    it("mount() throws when check() is in flight (checkerInit set, checker still null)", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      // Kick off check but do not await yet — checker is still null at this
      // point but checkerInit has been assigned.
      const inFlight = k.checkStroke(0, [
        { x: 0, y: 0, t: 0 },
        { x: 100, y: 100, t: 0 },
      ]);
      expect(() => k.mount(container)).toThrow("after check");
      // Drain the in-flight check so it resolves before the test exits.
      await inFlight;
    });

    it("check() throws on a mounted instance", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.mount(container);
      await expect(
        k.checkStroke(0, [
          { x: 0, y: 0, t: 0 },
          { x: 100, y: 100, t: 0 },
        ]),
      ).rejects.toThrow("not supported on a mounted instance");
    });
  });

  describe("check() / result()", () => {
    it("returns matched=true for a stroke that traces hanzi-writer's median", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      // mockCharData stroke 0 median: [[0,0], [100,100]]; trace it densely
      // enough to satisfy hanzi-writer's matcher.
      const trace = [
        { x: 0, y: 0, t: 0 },
        { x: 25, y: 25, t: 0 },
        { x: 50, y: 50, t: 0 },
        { x: 75, y: 75, t: 0 },
        { x: 100, y: 100, t: 0 },
      ];
      const r = await k.checkStroke(0, trace);
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
      const r = await k.checkStroke(0, [
        { x: 0, y: 0, t: 0 },
        { x: -500, y: -500, t: 0 },
      ]);
      expect(r.matched).toBe(false);
    });

    it("similarity is 0 once the average distance exceeds the matcher threshold", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const r = await k.checkStroke(0, [
        { x: 9999, y: 9999, t: 0 },
        { x: 10000, y: 10000, t: 0 },
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
        { x: 0, y: 0, t: 0 },
        { x: 50, y: 50, t: 0 },
        { x: 100, y: 100, t: 0 },
      ];
      const goodTrace1 = [
        { x: 200, y: 200, t: 0 },
        { x: 250, y: 250, t: 0 },
        { x: 300, y: 300, t: 0 },
      ];
      await k.checkStroke(0, goodTrace0);
      await k.checkStroke(1, goodTrace1);
      const res = k.result();
      expect(res.perStroke).toHaveLength(2);
      expect(res.perStroke[0].matched).toBe(true);
      expect(res.perStroke[1].matched).toBe(true);
      expect(res.matched).toBe(true);
    });

    it("result() returns independent placeholder objects for missing entries", async () => {
      // 3-stroke mock so that judging only the last index leaves two
      // separate gaps (indices 0 and 1) in the resulting array. The fix
      // gives each gap its own object so mutating one does not bleed
      // into the other.
      const threeStrokeData = {
        strokes: [
          "M 0 0 L 100 100",
          "M 200 200 L 300 300",
          "M 400 400 L 500 500",
        ],
        medians: [
          [[0, 0], [100, 100]],
          [[200, 200], [300, 300]],
          [[400, 400], [500, 500]],
        ],
      };
      const loader: CharDataLoaderFn = (_char, onLoad) => onLoad(threeStrokeData);
      const k = char.create("あ", {
        charDataLoader: loader,
        configLoader: null,
      });
      await k.ready();
      await k.checkStroke(2, [
        { x: 0, y: 0, t: 0 },
        { x: 50, y: 50, t: 0 },
      ]);
      const res = k.result();
      expect(res.perStroke).toHaveLength(3);
      // Two distinct placeholder objects, not the same shared reference.
      expect(res.perStroke[0]).not.toBe(res.perStroke[1]);
      res.perStroke[0].similarity = 999;
      expect(res.perStroke[1].similarity).toBe(0);
    });

    it("result() reports matched=false when at least one checked stroke missed", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      await k.checkStroke(0, [
        { x: 0, y: 0, t: 0 },
        { x: 50, y: 50, t: 0 },
        { x: 100, y: 100, t: 0 },
      ]);
      await k.checkStroke(1, [
        { x: -999, y: -999, t: 0 },
        { x: -888, y: -888, t: 0 },
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
      await expect(k.checkStroke(-1, [])).rejects.toThrow("non-negative integer");
      await expect(k.checkStroke(0.5, [])).rejects.toThrow("non-negative integer");
    });

    it("rejects strokeNum past the character's stroke count", async () => {
      // mockCharData has 2 strokes; check(2, ...) is one past the end.
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      await expect(
        k.checkStroke(2, [
          { x: 0, y: 0, t: 0 },
          { x: 50, y: 50, t: 0 },
        ]),
      ).rejects.toThrow("out of range");
    });

    it("rejects strokeNum past the configured strokeGroups length", async () => {
      // strokeGroups merges the 2 data strokes into 1 logical stroke;
      // check(1, ...) targets a logical index that is not in the configured
      // groups even though data index 1 still exists.
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        strokeGroups: [[0, 1]],
      });
      await k.ready();
      await expect(
        k.checkStroke(1, [
          { x: 0, y: 0, t: 0 },
          { x: 50, y: 50, t: 0 },
        ]),
      ).rejects.toThrow("strokeGroups configures 1 logical stroke");
    });

    it("destroy() while check() is in flight cleans up the offscreen container", async () => {
      const offscreenBefore = document.body.querySelectorAll(
        "div[aria-hidden=\"true\"]",
      ).length;
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const inFlight = k.checkStroke(0, [
        { x: 0, y: 0, t: 0 },
        { x: 50, y: 50, t: 0 },
      ]);
      // Synchronously destroy before the checker init resolves. ensureChecker
      // re-checks `destroyed` after its polling await and the catch path
      // drops the offscreen container; destroy() also absorbs the eventual
      // rejection so it does not bubble up as unhandled.
      k.destroy();
      await expect(inFlight).rejects.toThrow();
      // Wait one more tick for any pending DOM mutations to settle.
      await new Promise((r) => setTimeout(r, 20));
      const offscreenAfter = document.body.querySelectorAll(
        "div[aria-hidden=\"true\"]",
      ).length;
      expect(offscreenAfter).toBe(offscreenBefore);
    });

    it("propagates a charDataLoader failure as a real error from check()", async () => {
      const failingLoader: CharDataLoaderFn = (_char, _onLoad, onError) => {
        onError(new Error("load failed: 永"));
      };
      const k = char.create("永", {
        charDataLoader: failingLoader,
        configLoader: null,
      });
      // The exact error message hanzi-writer surfaces here is not stable
      // across versions, so just assert that check() rejects (rather than
      // hanging on the polling timeout) when the underlying loader fails.
      await expect(
        k.checkStroke(0, [
          { x: 0, y: 0, t: 0 },
          { x: 1, y: 1, t: 0 },
        ]),
      ).rejects.toThrow();
    });

    it("concurrent check() calls share a single offscreen container", async () => {
      const offscreenBefore = document.body.querySelectorAll(
        "div[aria-hidden=\"true\"]",
      ).length;
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const trace = [
        { x: 0, y: 0, t: 0 },
        { x: 50, y: 50, t: 0 },
        { x: 100, y: 100, t: 0 },
      ];
      // Without memoization, each Promise.all entry would race ensureChecker
      // and append its own offscreen container before any awaited step
      // resolves; the losers leak. Verify only one new offscreen container
      // ever lands on document.body.
      await Promise.all([
        k.checkStroke(0, trace),
        k.checkStroke(0, trace),
        k.checkStroke(0, trace),
      ]);
      const offscreenAfter = document.body.querySelectorAll(
        "div[aria-hidden=\"true\"]",
      ).length;
      expect(offscreenAfter - offscreenBefore).toBe(1);
      k.destroy();
    });

    it("sourceBox projects screen-space points into hanzi-writer internal coords", async () => {
      // mockCharData stroke 0 median is [(0, 0), (100, 100)] in internal
      // coords (Y up). The same shape on a HANZI_PRESCALED_SIZE-square
      // source (Y down, origin top-left) would draw from (0, HANZI_Y_MAX)
      // to (100, HANZI_Y_MAX - 100). With sourceBox set, check() must
      // flip Y around HANZI_Y_MAX and pass through unchanged in X
      // (since size matches HANZI_PRESCALED_SIZE).
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const sourceBox = { x: 0, y: 0, size: 1024 };
      const trace = [
        { x: 0, y: 900, t: 0 },
        { x: 25, y: 875, t: 0 },
        { x: 50, y: 850, t: 0 },
        { x: 75, y: 825, t: 0 },
        { x: 100, y: 800, t: 0 },
      ];
      const r = await k.checkStroke(0, trace, { sourceBox });
      expect(r.matched).toBe(true);
      expect(r.similarity).toBeGreaterThan(0);
    });

    it("sourceBox preserves the spatial relationship between strokes", async () => {
      // Both strokes drawn at their canonical (internal) positions but
      // expressed in screen coords on a HANZI_PRESCALED_SIZE × HANZI_PRESCALED_SIZE
      // square. Mock medians are [(0,0)-(100,100)] for stroke 0 and
      // [(200,200)-(300,300)] for stroke 1; both must match when fed
      // through the same sourceBox.
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const sourceBox = { x: 0, y: 0, size: 1024 };
      const stroke0 = [
        { x: 0, y: 900, t: 0 },
        { x: 50, y: 850, t: 0 },
        { x: 100, y: 800, t: 0 },
      ];
      const stroke1 = [
        { x: 200, y: 700, t: 0 },
        { x: 250, y: 650, t: 0 },
        { x: 300, y: 600, t: 0 },
      ];
      const r0 = await k.checkStroke(0, stroke0, { sourceBox });
      const r1 = await k.checkStroke(1, stroke1, { sourceBox });
      expect(r0.matched).toBe(true);
      expect(r1.matched).toBe(true);
    });

    it("CharStrokeResult.points is always in internal coords regardless of sourceBox", async () => {
      // Verify both halves of the new contract: (a) calling checkStroke
      // with a sourceBox stores the internal-projected form (not the
      // caller-supplied source coords), and (b) re-feeding those stored
      // points back through checkStroke WITHOUT a sourceBox round-trips
      // to the same verdict, so downstream consumers (replay, overlay
      // rendering against @k1low/hanzi-writer-data-jp) can treat the
      // result shape uniformly without knowing which input path
      // produced it.
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();

      const sourceBox = { x: 0, y: 0, size: 1024 };
      const sourceTrace = [
        { x: 0, y: 900, t: 0 },
        { x: 50, y: 850, t: 0 },
        { x: 100, y: 800, t: 0 },
      ];
      const r = await k.checkStroke(0, sourceTrace, { sourceBox });
      expect(r.points).toBeDefined();
      const got = r.points!;
      // The Y=0 / 1024-square sourceBox is the identity-after-flip case
      // documented on projectToInternal: x passes through, y becomes
      // HANZI_Y_MAX - y_source.
      expect(got).toHaveLength(sourceTrace.length);
      got.forEach((p, i) => {
        expect(p.x).toBeCloseTo(sourceTrace[i].x);
        expect(p.y).toBeCloseTo(900 - sourceTrace[i].y);
        expect(p.t).toBe(sourceTrace[i].t);
      });

      // Re-feeding the stored points back through checkStroke WITHOUT
      // sourceBox should reproduce the same verdict — the replay round
      // trip the new contract promises.
      const k2 = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k2.ready();
      const replay = await k2.checkStroke(0, got);
      expect(replay.matched).toBe(r.matched);
      expect(replay.similarity).toBeCloseTo(r.similarity);
    });

    it("sourceBox.size must be positive and finite", async () => {
      const k = char.create("あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      await expect(
        k.checkStroke(0, [
          { x: 0, y: 0, t: 0 },
          { x: 1, y: 1, t: 0 },
        ], { sourceBox: { x: 0, y: 0, size: 0 } }),
      ).rejects.toThrow("sourceBox.size must be a positive finite number");
      await expect(
        k.checkStroke(0, [
          { x: 0, y: 0, t: 0 },
          { x: 1, y: 1, t: 0 },
        ], { sourceBox: { x: 0, y: 0, size: Number.POSITIVE_INFINITY } }),
      ).rejects.toThrow("sourceBox.size must be a positive finite number");
    });
  });
});

describe("projectToInternal", () => {
  // These tests assert the projection formula at the source — independent
  // of hanzi-writer's matcher tolerance. A formula that flipped Y around
  // HANZI_PRESCALED_SIZE / 2 instead of HANZI_Y_MAX, or scaled by the
  // wrong canvas dim, would still pass `matched: true` tests through
  // matcher leniency, so the assertions below are intentionally exact.
  it("maps the source top-left corner to (0, HANZI_Y_MAX)", () => {
    const out = projectToInternal(
      [{ x: 100, y: 200, t: 7 }],
      { x: 100, y: 200, size: 512 },
    );
    expect(out[0].x).toBeCloseTo(0);
    expect(out[0].y).toBeCloseTo(900); // HANZI_Y_MAX
    expect(out[0].t).toBe(7); // timestamp passes through
  });

  it("maps the source bottom-right corner to (HANZI_PRESCALED_SIZE, HANZI_Y_MIN)", () => {
    const out = projectToInternal(
      [{ x: 100 + 512, y: 200 + 512, t: 9 }],
      { x: 100, y: 200, size: 512 },
    );
    expect(out[0].x).toBeCloseTo(1024); // HANZI_PRESCALED_SIZE
    expect(out[0].y).toBeCloseTo(-124); // HANZI_Y_MIN
    expect(out[0].t).toBe(9);
  });

  it("maps the source center to (HANZI_PRESCALED_SIZE/2, 388)", () => {
    // Y center is (HANZI_Y_MIN + HANZI_Y_MAX) / 2 = 388, NOT
    // HANZI_PRESCALED_SIZE / 2 = 512 — verifying the asymmetric Y range.
    const out = projectToInternal(
      [{ x: 100 + 256, y: 200 + 256, t: 0 }],
      { x: 100, y: 200, size: 512 },
    );
    expect(out[0].x).toBeCloseTo(512);
    expect(out[0].y).toBeCloseTo(388);
  });

  it("scales X and Y by HANZI_PRESCALED_SIZE / sourceBox.size", () => {
    // A 1024-unit source box should produce a 1:1 (pass-through) X
    // mapping plus a flip around HANZI_Y_MAX in Y.
    const out = projectToInternal(
      [{ x: 0, y: 0, t: 0 }, { x: 1024, y: 1024, t: 1 }],
      { x: 0, y: 0, size: 1024 },
    );
    expect(out[0].x).toBeCloseTo(0);
    expect(out[0].y).toBeCloseTo(900);
    expect(out[1].x).toBeCloseTo(1024);
    expect(out[1].y).toBeCloseTo(-124);
  });
});


describe("displayPxToHanziWriterDrawingWidth", () => {
  // The conversion mount() applies before forwarding
  // `MountOptions.drawingWidth` to hanzi-writer. Exposed as a pure
  // function so the display-px contract can be verified independently
  // of a real mount, which avoids hanzi-writer's full DOM lifecycle
  // in the assertion.

  it("falls back to DEFAULT_DRAWING_WIDTH when drawingWidth is undefined", () => {
    // size=300, padding=20 → innerSize=260; default 4 display px
    // maps to 4 * 1024 / 260 ≈ 15.75 internal-coord units.
    const result = displayPxToHanziWriterDrawingWidth(undefined, 300, 20);
    expect(result).toBeCloseTo((DEFAULT_DRAWING_WIDTH * HANZI_PRESCALED_SIZE) / 260);
  });

  it("scales display px against innerSize so on-screen thickness is size-independent", () => {
    // The same display-px request (6 px) on two different cell sizes
    // should map to different internal widths, but both convert back
    // to 6 px on-screen via hanzi-writer's `<g>` scale of
    // `HANZI_PRESCALED_SIZE / innerSize`.
    const small = displayPxToHanziWriterDrawingWidth(6, 160, 0);
    const large = displayPxToHanziWriterDrawingWidth(6, 480, 0);
    // small: 6 * 1024 / 160 = 38.4
    expect(small).toBeCloseTo((6 * HANZI_PRESCALED_SIZE) / 160);
    // large: 6 * 1024 / 480 = 12.8
    expect(large).toBeCloseTo((6 * HANZI_PRESCALED_SIZE) / 480);
    // Round-trip: internal * innerSize / HANZI_PRESCALED_SIZE = 6
    expect((small * 160) / HANZI_PRESCALED_SIZE).toBeCloseTo(6);
    expect((large * 480) / HANZI_PRESCALED_SIZE).toBeCloseTo(6);
  });

  it("respects padding when computing innerSize", () => {
    // size=300, padding=50 → innerSize=200, not 300; the conversion
    // must use the inner box, not the outer size, otherwise padding
    // silently thins the on-screen pen.
    const result = displayPxToHanziWriterDrawingWidth(6, 300, 50);
    expect(result).toBeCloseTo((6 * HANZI_PRESCALED_SIZE) / 200);
  });

  it("passes the display value through when innerSize is degenerate", () => {
    // padding ≥ size/2 leaves no inner box; guard against the
    // divide-by-zero and just emit the original value so callers
    // still get a finite drawingWidth they can debug from.
    expect(displayPxToHanziWriterDrawingWidth(8, 100, 50)).toBe(8);
    expect(displayPxToHanziWriterDrawingWidth(8, 100, 60)).toBe(8);
  });
});

describe("computeRetainedStrokeAttrs", () => {
  // Standard non-CSS-scaled setup mirrors a mounted Char with
  // size=300, padding=20: inner box is 260 px on a 300 px layer.
  const SIZE = 300;
  const PADDING = 20;
  const INNER = SIZE - 2 * PADDING; // 260
  // proj.scale = HANZI_PRESCALED_SIZE / innerSize_cssScaled.
  // In the cssScale=1 setup that's 1024 / 260.
  const PROJ_1X = {
    originX: PADDING, // assumes layerRect.left == 0
    originY: PADDING,
    scale: 1024 / INNER,
  };
  const RECT_1X = { left: 0, top: 0, width: SIZE };

  it("returns null for inputs with fewer than 2 points", () => {
    expect(
      computeRetainedStrokeAttrs([], PROJ_1X, RECT_1X, SIZE, PADDING, {}),
    ).toBeNull();
    expect(
      computeRetainedStrokeAttrs(
        [{ x: 0, y: 0, t: 0 }],
        PROJ_1X,
        RECT_1X,
        SIZE,
        PADDING,
        {},
      ),
    ).toBeNull();
  });

  it("maps internal (0, HANZI_Y_MAX) to the inner-box top-left in logical px", () => {
    // Internal (x=0, y=900) corresponds to the user clicking at the
    // top-left of the inner box, so the polyline should land at
    // (padding, padding).
    const attrs = computeRetainedStrokeAttrs(
      [
        { x: 0, y: 900, t: 0 },
        { x: 1, y: 899, t: 1 },
      ],
      PROJ_1X,
      RECT_1X,
      SIZE,
      PADDING,
      { drawingWidth: 12 },
    );
    expect(attrs).not.toBeNull();
    const [x0, y0] = attrs!.points.split(" ")[0].split(",").map(Number);
    expect(x0).toBeCloseTo(PADDING);
    expect(y0).toBeCloseTo(PADDING);
  });

  it("maps internal (HANZI_PRESCALED_SIZE, HANZI_Y_MIN) to the inner-box bottom-right", () => {
    const attrs = computeRetainedStrokeAttrs(
      [
        { x: 0, y: 0, t: 0 },
        { x: 1024, y: -124, t: 1 },
      ],
      PROJ_1X,
      RECT_1X,
      SIZE,
      PADDING,
      { drawingWidth: 12 },
    );
    const [xLast, yLast] = attrs!.points.split(" ")[1].split(",").map(Number);
    expect(xLast).toBeCloseTo(SIZE - PADDING);
    expect(yLast).toBeCloseTo(SIZE - PADDING);
  });

  it("respects layer CSS scale: same internal coords land in the same logical px", () => {
    // When the host CSS-scales the layer (e.g. transform: scale(2)),
    // captureProjection records originX/Y in CSS coords and scale
    // against the cssScale-adjusted inner size. The polyline result
    // should still be in logical viewBox units, not CSS px.
    const cssScale = 2;
    const proj2X = {
      originX: PADDING * cssScale, // layerRect.left=0 + paddingScaled
      originY: PADDING * cssScale,
      scale: 1024 / (INNER * cssScale),
    };
    const rect2X = { left: 0, top: 0, width: SIZE * cssScale };
    const attrs = computeRetainedStrokeAttrs(
      [
        { x: 0, y: 900, t: 0 },
        { x: 1024, y: -124, t: 1 },
      ],
      proj2X,
      rect2X,
      SIZE,
      PADDING,
      { drawingWidth: 12 },
    );
    const [x0, y0] = attrs!.points.split(" ")[0].split(",").map(Number);
    const [x1, y1] = attrs!.points.split(" ")[1].split(",").map(Number);
    expect(x0).toBeCloseTo(PADDING);
    expect(y0).toBeCloseTo(PADDING);
    expect(x1).toBeCloseTo(SIZE - PADDING);
    expect(y1).toBeCloseTo(SIZE - PADDING);
  });

  it("uses drawingWidth verbatim (display pixels)", () => {
    // `drawingWidth` is documented in display pixels; the live-ink
    // overlay's viewBox is `0..size` so the value applies verbatim.
    // mount() handles the hanzi-writer internal-coord conversion
    // for the underlying pen; the retained overlay matches whatever
    // display-px pen the caller asked for.
    const attrs = computeRetainedStrokeAttrs(
      [
        { x: 0, y: 0, t: 0 },
        { x: 1, y: 0, t: 1 },
      ],
      PROJ_1X,
      RECT_1X,
      SIZE,
      PADDING,
      { drawingWidth: 12 },
    );
    expect(attrs!.strokeWidth).toBe(12);
  });

  it("retainedStrokeWidth overrides the drawingWidth-derived default", () => {
    const attrs = computeRetainedStrokeAttrs(
      [
        { x: 0, y: 0, t: 0 },
        { x: 1, y: 0, t: 1 },
      ],
      PROJ_1X,
      RECT_1X,
      SIZE,
      PADDING,
      { drawingWidth: 12, retainedStrokeWidth: 7 },
    );
    expect(attrs!.strokeWidth).toBe(7);
  });

  it("retainedStrokeColor overrides drawingColor", () => {
    const attrs = computeRetainedStrokeAttrs(
      [
        { x: 0, y: 0, t: 0 },
        { x: 1, y: 0, t: 1 },
      ],
      PROJ_1X,
      RECT_1X,
      SIZE,
      PADDING,
      { drawingColor: "#aaa", retainedStrokeColor: "#222" },
    );
    expect(attrs!.stroke).toBe("#222");
  });
});
