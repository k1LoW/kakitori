import { describe, it, expect, vi } from "vitest";
import { createFreeCell } from "./freeCell.js";
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

  it("deferred check() with a failed verdict wipes the cell and fires onCellRejected", async () => {
    // Full-cell NG retry: when the matcher exhausts every candidate
    // and commits fail, a subsequent FreeCellHandle.check() must
    // clear every surface (drop the polylines + reset matcher
    // bookkeeping) and fire onCellRejected instead of onCellComplete,
    // so the user can rewrite the whole string in place.
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onCellCaptured = vi.fn();
    const onCellComplete = vi.fn();
    const onCellRejected = vi.fn();
    const handle = createFreeCell({
      expected: "あ",
      surfaces: [{ parent, width: 200, height: 200 }],
      loaders: { charDataLoader: stubLoader, configLoader: null },
      deferred: true,
      onCellCaptured,
      onCellComplete,
      onCellRejected,
    });
    const surface = handle.els[0];

    // "あ" via stubLoader has 1 stroke (max=1). With max=1 the
    // matcher runs after the first stroke: if similarity is below
    // the threshold the cell already commits fail; if it is above,
    // the second stroke's `total > max` path commits fail. Drawing
    // two intentionally mis-shaped strokes guarantees the failure
    // lands regardless of which branch fires first.
    strokeAt(surface, [[10, 10], [80, 80]], 1);
    strokeAt(surface, [[10, 80], [80, 10]], 2);
    await new Promise((r) => setTimeout(r, 100));

    expect(onCellCaptured).toHaveBeenCalledTimes(1);
    expect(onCellComplete).not.toHaveBeenCalled();

    handle.check();
    expect(onCellRejected).toHaveBeenCalledTimes(1);
    expect(onCellComplete).not.toHaveBeenCalled();
    // Every polyline across every surface dropped.
    expect(surface.querySelectorAll("polyline").length).toBe(0);

    handle.destroy();
    parent.remove();
  });

  it("non-deferred commitFail wipes the cell and fires onCellRejected", async () => {
    // Non-deferred mirror of the deferred check()-failed retry path:
    // when commitFail lands (matcher exhausted every candidate, no
    // match), the cell wipes every stroke across every surface and
    // fires onCellRejected with the rejected verdict — `onCellComplete`
    // is held back for the eventual OK round. This locks in the
    // breaking switch from "paint failedColor + onCellComplete" to
    // "wipe + onCellRejected".
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onCellComplete = vi.fn();
    const onCellRejected = vi.fn();
    const handle = createFreeCell({
      expected: "あ",
      surfaces: [{ parent, width: 200, height: 200 }],
      loaders: { charDataLoader: stubLoader, configLoader: null },
      onCellComplete,
      onCellRejected,
    });
    const surface = handle.els[0];

    strokeAt(surface, [[10, 10], [80, 80]], 1);
    strokeAt(surface, [[10, 80], [80, 10]], 2);
    await new Promise((r) => setTimeout(r, 100));

    expect(onCellRejected).toHaveBeenCalledTimes(1);
    expect(onCellComplete).not.toHaveBeenCalled();
    expect(surface.querySelectorAll("polyline").length).toBe(0);
    // The rejected verdict's chars are forwarded so hosts can still
    // observe what was attempted.
    const rejectedChars = onCellRejected.mock.calls[0][0];
    expect(Array.isArray(rejectedChars)).toBe(true);

    handle.destroy();
    parent.remove();
  });

  it("maxRetries: 0 commits onCellComplete on the first failed commit", async () => {
    // No retry budget — the first commitFail (here driven by
    // similarity threshold / max-stroke breach) lands directly on
    // onCellComplete with the rejected chars, never firing
    // onCellRejected.
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onCellComplete = vi.fn();
    const onCellRejected = vi.fn();
    const handle = createFreeCell({
      expected: "あ",
      surfaces: [{ parent, width: 200, height: 200 }],
      loaders: { charDataLoader: stubLoader, configLoader: null },
      maxRetries: 0,
      onCellComplete,
      onCellRejected,
    });
    const surface = handle.els[0];

    strokeAt(surface, [[10, 10], [80, 80]], 1);
    strokeAt(surface, [[10, 80], [80, 10]], 2);
    await new Promise((r) => setTimeout(r, 100));

    expect(onCellRejected).not.toHaveBeenCalled();
    expect(onCellComplete).toHaveBeenCalledTimes(1);

    handle.destroy();
    parent.remove();
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
