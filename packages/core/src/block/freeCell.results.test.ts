import { describe, it, expect } from "vitest";
import { createFreeCell } from "./freeCell.js";
import type { CharDataLoaderFn } from "../charOptions.js";

const stubLoader: CharDataLoaderFn = (_c, onLoad) => {
  onLoad({
    strokes: ["M 0 0 L 100 100"],
    medians: [[[0, 0], [100, 100]]],
  });
};

describe("FreeCellHandle.results", () => {
  it("returns placeholder entries for the first candidate when no strokes have been drawn", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const handle = createFreeCell({
      expected: ["がっこう", "ガッコウ"],
      surfaces: [{ parent, width: 200, height: 200 }],
      loaders: { charDataLoader: stubLoader, configLoader: null },
    });
    const chars = handle.results();
    expect(chars.map((c) => c.character)).toEqual(["が", "っ", "こ", "う"]);
    for (const c of chars) {
      expect(c.complete).toBe(false);
      expect(c.matched).toBe(true); // vacuous
      expect(c.perStroke).toEqual([]);
    }
    handle.destroy();
    parent.remove();
  });

  it("rejects an empty expected[] at construction time", () => {
    // No candidate means there's no character to write — the
    // placeholder helper would have nothing to size against, so
    // construction throws before results() ever needs to handle the
    // empty-candidate case.
    expect(() =>
      createFreeCell({
        expected: [],
        surfaces: [
          {
            parent: document.createElement("div"),
            width: 100,
            height: 100,
          },
        ],
        loaders: { charDataLoader: stubLoader, configLoader: null },
      }),
    ).toThrow();
  });

  it("reset() drops settled / in-flight state back to placeholder", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const handle = createFreeCell({
      expected: "あ",
      surfaces: [{ parent, width: 200, height: 200 }],
      loaders: { charDataLoader: stubLoader, configLoader: null },
    });
    // Reset before any strokes is a no-op snapshot-wise.
    handle.reset();
    const chars = handle.results();
    expect(chars).toHaveLength(1);
    expect(chars[0].character).toBe("あ");
    expect(chars[0].complete).toBe(false);
    handle.destroy();
    parent.remove();
  });
});
