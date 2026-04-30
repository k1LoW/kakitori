import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Kakitori } from "./Kakitori.js";
import type { RenderOptions } from "./KakitoriOptions.js";
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
});
