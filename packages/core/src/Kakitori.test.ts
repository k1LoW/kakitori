import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Kakitori, computeMedianPathLength } from "./Kakitori.js";
import type { CharDataLoaderFn } from "./KakitoriOptions.js";

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

describe("Kakitori", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe("create", () => {
    it("creates a Kakitori instance", () => {
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      expect(k).toBeInstanceOf(Kakitori);
    });

    it("creates SVG inside the container", () => {
      Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
    });

    it("respects size option", () => {
      Kakitori.create(container, "あ", {
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
        Kakitori.create(container, "あ", {
          size: Number.NaN,
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
      }).toThrow("size must be finite");
    });

    it("throws when padding is Infinity", () => {
      expect(() => {
        Kakitori.create(container, "あ", {
          padding: Number.POSITIVE_INFINITY,
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
      }).toThrow("padding must be finite");
    });

    it("throws when padding is negative", () => {
      expect(() => {
        Kakitori.create(container, "あ", {
          padding: -1,
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
      }).toThrow("padding must be non-negative");
    });

    it("throws when size is zero", () => {
      expect(() => {
        Kakitori.create(container, "あ", {
          size: 0,
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
      }).toThrow("size must be positive");
    });

    it("throws when size is negative", () => {
      expect(() => {
        Kakitori.create(container, "あ", {
          size: -10,
          charDataLoader: mockCharDataLoader,
          configLoader: null,
        });
      }).toThrow("size must be positive");
    });

    it("throws when padding >= size/2", () => {
      expect(() => {
        Kakitori.create(container, "あ", {
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
      Kakitori.render(container, "あ", {
        charDataLoader: mockCharDataLoader,
      });
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      const paths = svg!.querySelectorAll("path");
      expect(paths).toHaveLength(mockCharData.strokes.length);
    });

    it("respects size and padding options", () => {
      Kakitori.render(container, "あ", {
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
        Kakitori.render(container, "あ", {
          size: Number.NaN,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("size must be finite");
    });

    it("throws when padding is Infinity", () => {
      expect(() => {
        Kakitori.render(container, "あ", {
          padding: Number.POSITIVE_INFINITY,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("padding must be finite");
    });

    it("throws when padding is negative", () => {
      expect(() => {
        Kakitori.render(container, "あ", {
          padding: -1,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("padding must be non-negative");
    });

    it("throws when size is zero", () => {
      expect(() => {
        Kakitori.render(container, "あ", {
          size: 0,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("size must be positive");
    });

    it("throws when size is negative", () => {
      expect(() => {
        Kakitori.render(container, "あ", {
          size: -10,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("size must be positive");
    });

    it("throws when padding >= size/2", () => {
      expect(() => {
        Kakitori.render(container, "あ", {
          size: 100,
          padding: 50,
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("padding (50) must be less than size/2");
    });

    it("applies strokeColor to paths", () => {
      Kakitori.render(container, "あ", {
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
      Kakitori.render(container, "あ", {
        charDataLoader: mockCharDataLoader,
        onClick,
      });
      const svg = container.querySelector("svg")!;
      expect(svg.style.cursor).toBe("pointer");
      svg.dispatchEvent(new Event("click"));
      expect(onClick).toHaveBeenCalledWith({ character: "あ" });
    });

    it("does not add click listener when onClick is not provided", () => {
      Kakitori.render(container, "あ", {
        charDataLoader: mockCharDataLoader,
      });
      const svg = container.querySelector("svg")!;
      expect(svg.style.cursor).not.toBe("pointer");
    });

    it("throws when target selector does not match", () => {
      expect(() => {
        Kakitori.render("#nonexistent", "あ", {
          charDataLoader: mockCharDataLoader,
        });
      }).toThrow("did not match any element");
    });

    it("logs error on load failure", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const failLoader: CharDataLoaderFn = (_char, _onLoad, onError) => {
        onError(new Error("load failed"));
      };
      Kakitori.render(container, "あ", {
        charDataLoader: failLoader,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("failed to load"),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it("applies correct SVG transform for coordinate system", () => {
      Kakitori.render(container, "あ", {
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
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await expect(k.ready()).resolves.toBeUndefined();
    });

    it("resolves after config loads", async () => {
      const k = Kakitori.create(container, "あ", {
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
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      expect(k.getStrokeEndings()).toBeNull();
      expect(k.getStrokeGroups()).toBeNull();
    });

    it("returns config values after loading", async () => {
      const k = Kakitori.create(container, "あ", {
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
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.setStrokeEndings([{ types: ["hane"] }]);
      expect(k.getStrokeEndings()).toEqual([{ types: ["hane"] }]);
    });

    it("overrides stroke groups", () => {
      const k = Kakitori.create(container, "あ", {
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
      const k = Kakitori.create(container, "あ", {
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
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      expect(container.querySelector("svg")).not.toBeNull();
      k.destroy();
      expect(container.querySelector("svg")).toBeNull();
      expect(container.innerHTML).toBe("");
    });

    it("can be called multiple times safely", () => {
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.destroy();
      expect(() => k.destroy()).not.toThrow();
    });

    it("throws when public methods are called after destroy", async () => {
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      k.destroy();
      const expectedMessage = "Kakitori: instance has been destroyed";
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
      // setCharacter is async; synchronous throw becomes a rejected promise.
      await expect(k.setCharacter("い")).rejects.toThrow(expectedMessage);
    });
  });

  describe("onClick option", () => {
    it("fires onClick with character and strokeIndex null when no stroke hit", () => {
      const onClick = vi.fn();
      Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        onClick,
      });
      container.click();
      expect(onClick).toHaveBeenCalledWith({
        character: "あ",
        strokeIndex: null,
      });
    });
  });

  describe("setStrokeColor / resetStrokeColor / resetStrokeColors", () => {
    function createWithStubPaths() {
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const ns = "http://www.w3.org/2000/svg";
      const paths = [
        document.createElementNS(ns, "path") as unknown as SVGPathElement,
        document.createElementNS(ns, "path") as unknown as SVGPathElement,
      ];
      paths[0].style.stroke = "#555";
      paths[1].style.stroke = "#555";
      vi.spyOn(k as any, "getStrokePaths").mockReturnValue(paths);
      return { k, paths };
    }

    it("setStrokeColor sets stroke color", () => {
      const { k, paths } = createWithStubPaths();
      k.setStrokeColor(0, "#c00");
      expect(paths[0].style.stroke).toBe("#c00");
    });

    it("setStrokeColor preserves original on repeated calls", () => {
      const { k, paths } = createWithStubPaths();
      k.setStrokeColor(0, "#c00");
      expect(paths[0].dataset.kakitoriOriginalStroke).toBe("#555");
      k.setStrokeColor(0, "#00f");
      expect(paths[0].dataset.kakitoriOriginalStroke).toBe("#555");
      expect(paths[0].style.stroke).toBe("#00f");
    });

    it("resetStrokeColor restores a single stroke", () => {
      const { k, paths } = createWithStubPaths();
      k.setStrokeColor(0, "#c00");
      k.resetStrokeColor(0);
      expect(paths[0].style.stroke).toBe("#555");
      expect(paths[0].dataset.kakitoriOriginalStroke).toBeUndefined();
    });

    it("resetStrokeColors restores all strokes", () => {
      const { k, paths } = createWithStubPaths();
      k.setStrokeColor(0, "#c00");
      k.setStrokeColor(1, "#0c0");
      k.resetStrokeColors();
      expect(paths[0].style.stroke).toBe("#555");
      expect(paths[1].style.stroke).toBe("#555");
      expect(paths[0].dataset.kakitoriOriginalStroke).toBeUndefined();
      expect(paths[1].dataset.kakitoriOriginalStroke).toBeUndefined();
    });
  });

  describe("showGrid option", () => {
    it("does not draw grid lines when showGrid is omitted", () => {
      Kakitori.create(container, "あ", {
        size: 300,
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      const lines = container.querySelectorAll("svg > line");
      expect(lines).toHaveLength(0);
    });

    it("draws cross-hair grid lines when showGrid is true (create)", () => {
      Kakitori.create(container, "あ", {
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
      Kakitori.create(container, "あ", {
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
      Kakitori.create(container, "あ", {
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
      Kakitori.render(container, "あ", {
        size: 300,
        showGrid: true,
        charDataLoader: mockCharDataLoader,
      });
      const lines = container.querySelectorAll("svg > line");
      expect(lines).toHaveLength(2);
    });

    it("does not block clicks from reaching onClick when showGrid is true", () => {
      const onClick = vi.fn();
      Kakitori.create(container, "あ", {
        size: 300,
        showGrid: true,
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        onClick,
      });

      // The grid sits on top of hanzi-writer's SVG, so clicks must pass
      // through it. pointer-events:none on the SVG itself and on each <line>
      // is what guarantees that contract.
      const gridSvg = container.querySelector("svg.kakitori-grid") as SVGSVGElement;
      expect(gridSvg.style.pointerEvents).toBe("none");
      for (const line of gridSvg.querySelectorAll("line")) {
        expect(line.getAttribute("pointer-events")).toBe("none");
      }

      container.click();
      expect(onClick).toHaveBeenCalledWith({
        character: "あ",
        strokeIndex: null,
      });
    });
  });

  describe("hanzi-writer integration (monkey patch survival)", () => {
    async function startAndWaitForPatch(
      k: Kakitori,
      timeoutMs = 1000,
    ): Promise<any> {
      k.start();
      await expect
        .poll(() => (k as any).hw._quiz?.__kakitoriPatched === true, {
          timeout: timeoutMs,
        })
        .toBe(true);
      return (k as any).hw._quiz;
    }

    function fakeUserStroke() {
      return {
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
        ],
        externalPoints: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
        ],
      };
    }

    it("Quiz instance exposes the private API the patch depends on", async () => {
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
      });
      await k.ready();
      const quiz = await startAndWaitForPatch(k);

      expect(typeof quiz._handleSuccess).toBe("function");
      expect(typeof quiz._handleFailure).toBe("function");
      expect(typeof quiz._getStrokeData).toBe("function");
      expect(typeof quiz._currentStrokeIndex).toBe("number");
      expect(quiz.__kakitoriPatched).toBe(true);
    });

    it("skips ending judgment when strokeEndings is not set", async () => {
      const onStrokeEndingMistake = vi.fn();
      const onMistake = vi.fn();
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        strokeEndingAsMiss: true,
        onStrokeEndingMistake,
        onMistake,
      });
      await k.ready();
      const quiz = await startAndWaitForPatch(k);

      quiz._userStroke = fakeUserStroke();
      const initialIndex = quiz._currentStrokeIndex;
      const initialMistakes = quiz._totalMistakes;

      quiz._handleSuccess({ isStrokeBackwards: false });

      // Judgment skipped → original success path → stroke advances, no mistakes
      expect(quiz._currentStrokeIndex).toBe(initialIndex + 1);
      expect(quiz._totalMistakes).toBe(initialMistakes);
      expect(onStrokeEndingMistake).not.toHaveBeenCalled();
      expect(onMistake).not.toHaveBeenCalled();
    });

    it("rejects stroke and does not advance when ending fails with strokeEndingAsMiss=true", async () => {
      const onStrokeEndingMistake = vi.fn();
      const onMistake = vi.fn();
      const onCorrectStroke = vi.fn();
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        strokeEndingAsMiss: true,
        onStrokeEndingMistake,
        onMistake,
        onCorrectStroke,
      });
      await k.ready();
      // Force a failing judgment: expect harai, but the fake stroke has no
      // timing data so the judge falls back to "tome" → mismatch.
      // No setStrokeGroups: judgment must apply to every stroke when groups
      // are unset (regression for the strokeGroups-required bug).
      k.setStrokeEndings([
        { types: ["harai"], direction: [0, -1] },
        { types: ["harai"], direction: [0, -1] },
      ]);
      const quiz = await startAndWaitForPatch(k);

      quiz._userStroke = fakeUserStroke();
      const initialIndex = quiz._currentStrokeIndex;

      quiz._handleSuccess({ isStrokeBackwards: false });

      expect(quiz._currentStrokeIndex).toBe(initialIndex);
      expect(quiz._totalMistakes).toBeGreaterThan(0);
      expect(onStrokeEndingMistake).toHaveBeenCalledTimes(1);
      expect(onMistake).toHaveBeenCalledTimes(1);
      expect(onCorrectStroke).not.toHaveBeenCalled();
    });

    it("advances stroke when ending fails with strokeEndingAsMiss=false (default)", async () => {
      const onStrokeEndingMistake = vi.fn();
      const onCorrectStroke = vi.fn();
      const onMistake = vi.fn();
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        onStrokeEndingMistake,
        onCorrectStroke,
        onMistake,
      });
      await k.ready();
      // No setStrokeGroups: judgment must apply to every stroke when groups
      // are unset (regression for the strokeGroups-required bug).
      k.setStrokeEndings([
        { types: ["harai"], direction: [0, -1] },
        { types: ["harai"], direction: [0, -1] },
      ]);
      const quiz = await startAndWaitForPatch(k);

      quiz._userStroke = fakeUserStroke();
      const initialIndex = quiz._currentStrokeIndex;

      quiz._handleSuccess({ isStrokeBackwards: false });

      expect(quiz._currentStrokeIndex).toBe(initialIndex + 1);
      expect(onStrokeEndingMistake).toHaveBeenCalledTimes(1);
      expect(onCorrectStroke).toHaveBeenCalledTimes(1);
      expect(onMistake).not.toHaveBeenCalled();
    });

    it("reports consistent strokesRemaining between onStrokeEndingMistake and onCorrectStroke when group auto-skips", async () => {
      const onStrokeEndingMistake = vi.fn();
      const onCorrectStroke = vi.fn();
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        onStrokeEndingMistake,
        onCorrectStroke,
      });
      await k.ready();
      // 2 data strokes collapsed into a single logical stroke: drawing data
      // stroke 0 auto-skips data stroke 1.
      k.setStrokeGroups([[0, 1]]);
      k.setStrokeEndings([{ types: ["harai"], direction: [0, -1] }]);
      const quiz = await startAndWaitForPatch(k);

      quiz._userStroke = fakeUserStroke();
      quiz._handleSuccess({ isStrokeBackwards: false });

      expect(onStrokeEndingMistake).toHaveBeenCalledTimes(1);
      expect(onCorrectStroke).toHaveBeenCalledTimes(1);
      const mistakeRemaining =
        onStrokeEndingMistake.mock.calls[0][0].strokesRemaining;
      const correctRemaining =
        onCorrectStroke.mock.calls[0][0].strokesRemaining;
      expect(mistakeRemaining).toBe(correctRemaining);
    });

    it("reports strokesRemaining in logical-stroke units across multiple groups", async () => {
      const fourStrokeCharData = {
        strokes: [
          "M 0 0 L 100 100",
          "M 100 100 L 200 200",
          "M 200 200 L 300 300",
          "M 300 300 L 400 400",
        ],
        medians: [
          [[0, 0], [100, 100]],
          [[100, 100], [200, 200]],
          [[200, 200], [300, 300]],
          [[300, 300], [400, 400]],
        ],
      };
      const fourStrokeLoader: CharDataLoaderFn = (_char, onLoad) => {
        onLoad(fourStrokeCharData);
      };
      const onCorrectStroke = vi.fn();
      const onMistake = vi.fn();
      const k = Kakitori.create(container, "X", {
        charDataLoader: fourStrokeLoader,
        configLoader: null,
        onCorrectStroke,
        onMistake,
      });
      await k.ready();
      // 2 logical strokes, each spanning 2 data strokes.
      k.setStrokeGroups([[0, 1], [2, 3]]);
      const quiz = await startAndWaitForPatch(k);

      // Drawing data stroke 0 (first of group [0, 1]): logical stroke 0 done
      // → 1 logical stroke remaining (group [2, 3]).
      quiz._userStroke = fakeUserStroke();
      quiz._handleSuccess({ isStrokeBackwards: false });
      expect(onCorrectStroke).toHaveBeenCalledTimes(1);
      expect(onCorrectStroke.mock.calls[0][0].strokesRemaining).toBe(1);

      // Mistake on data stroke 2 (first of group [2, 3]): logical stroke 1
      // is the current pending one → 1 logical stroke remaining (current).
      quiz._userStroke = fakeUserStroke();
      quiz._handleFailure({ isStrokeBackwards: false });
      expect(onMistake).toHaveBeenCalledTimes(1);
      expect(onMistake.mock.calls[0][0].strokesRemaining).toBe(1);
    });

    it("falls back to hanzi-writer's strokesRemaining when strokeGroups is incomplete", async () => {
      const onMistake = vi.fn();
      const k = Kakitori.create(container, "あ", {
        charDataLoader: mockCharDataLoader,
        configLoader: null,
        onMistake,
      });
      await k.ready();
      // Only stroke 0 is mapped; stroke 1 is unmapped (incomplete groups).
      k.setStrokeGroups([[0]]);
      const quiz = await startAndWaitForPatch(k);

      // Drive a mistake on the unmapped data stroke 1.
      quiz._currentStrokeIndex = 1;
      quiz._userStroke = fakeUserStroke();
      quiz._handleFailure({ isStrokeBackwards: false });

      expect(onMistake).toHaveBeenCalledTimes(1);
      // Without the fallback the formula would yield `strokeGroups.length -
      // dataStrokeNum - 0 = 1 - 1 - 0 = 0`. With the fallback, callbacks
      // receive hanzi-writer's raw value: `strokes.length - currentIndex - 0
      // = 2 - 1 - 0 = 1`. Asserting the exact value catches a regression of
      // the fallback (and underflow for larger unmapped indices in general).
      expect(onMistake.mock.calls[0][0].strokesRemaining).toBe(1);
    });
  });

  describe("animate() rapid succession", () => {
    it("keeps at most one .kakitori-anim overlay when animate() is called repeatedly", async () => {
      vi.useFakeTimers();
      try {
        const k = Kakitori.create(container, "あ", {
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
        const k = Kakitori.create(container, "あ", {
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
        const k = Kakitori.create(container, "あ", {
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
      const k = Kakitori.create(container, "あ", {
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
});
