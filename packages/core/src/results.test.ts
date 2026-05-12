import { describe, it, expect } from "vitest";
import { collectCharResults } from "./results.js";
import type { BlockResult } from "./block/index.js";
import type { CharResult } from "./charOptions.js";
import type { PageResult } from "./page/index.js";

function makeChar(
  character: string,
  source: "guided" | "free" | "annotation",
  mode: "write" | "show",
  complete: boolean,
): CharResult {
  return {
    character,
    complete,
    matched: true,
    perStroke: [],
    source,
    mode,
  };
}

function makeBlock(args: {
  id?: string;
  cells: Array<{ kind: "guided" | "free" | "blank"; chars: CharResult[] }>;
  annotations?: Array<{ chars: CharResult[] }>;
}): BlockResult {
  return {
    ...(args.id !== undefined ? { id: args.id } : {}),
    complete: false,
    matched: true,
    cells: args.cells,
    annotations: args.annotations ?? [],
  };
}

describe("collectCharResults", () => {
  it("returns every char in a BlockResult when no filter is supplied", () => {
    const block = makeBlock({
      cells: [
        { kind: "guided", chars: [makeChar("学", "guided", "write", true)] },
        { kind: "guided", chars: [makeChar("校", "guided", "show", true)] },
      ],
      annotations: [
        {
          chars: [
            makeChar("が", "annotation", "write", false),
            makeChar("っ", "annotation", "write", false),
          ],
        },
      ],
    });
    const all = collectCharResults(block);
    expect(all.map((c) => c.character)).toEqual(["学", "校", "が", "っ"]);
  });

  it("filters by sources", () => {
    const block = makeBlock({
      cells: [
        { kind: "guided", chars: [makeChar("学", "guided", "write", true)] },
        { kind: "free", chars: [makeChar("が", "free", "write", true)] },
      ],
      annotations: [
        { chars: [makeChar("ふ", "annotation", "write", true)] },
      ],
    });
    expect(
      collectCharResults(block, { sources: ["guided"] }).map((c) => c.character),
    ).toEqual(["学"]);
    expect(
      collectCharResults(block, { sources: ["free", "annotation"] }).map(
        (c) => c.character,
      ),
    ).toEqual(["が", "ふ"]);
  });

  it("filters by modes", () => {
    const block = makeBlock({
      cells: [
        { kind: "guided", chars: [makeChar("学", "guided", "write", false)] },
        { kind: "guided", chars: [makeChar("校", "guided", "show", true)] },
      ],
    });
    expect(
      collectCharResults(block, { modes: ["write"] }).map((c) => c.character),
    ).toEqual(["学"]);
    expect(
      collectCharResults(block, { modes: ["show"] }).map((c) => c.character),
    ).toEqual(["校"]);
  });

  it("filters by completedOnly", () => {
    const block = makeBlock({
      cells: [
        { kind: "guided", chars: [makeChar("学", "guided", "write", true)] },
        { kind: "guided", chars: [makeChar("校", "guided", "write", false)] },
      ],
    });
    expect(
      collectCharResults(block, { completedOnly: true }).map((c) => c.character),
    ).toEqual(["学"]);
  });

  it("combines filters", () => {
    const block = makeBlock({
      cells: [
        { kind: "guided", chars: [makeChar("学", "guided", "write", true)] },
        { kind: "guided", chars: [makeChar("校", "guided", "show", true)] },
        { kind: "free", chars: [makeChar("が", "free", "write", false)] },
      ],
    });
    // Want: only guided WRITE completed → just 学.
    expect(
      collectCharResults(block, {
        sources: ["guided"],
        modes: ["write"],
        completedOnly: true,
      }).map((c) => c.character),
    ).toEqual(["学"]);
  });

  it("walks a PageResult by flattening across blocks", () => {
    const page: PageResult = {
      complete: false,
      matched: true,
      blocks: [
        makeBlock({
          id: "q1",
          cells: [
            { kind: "guided", chars: [makeChar("学", "guided", "write", true)] },
          ],
        }),
        makeBlock({
          id: "q2",
          cells: [
            { kind: "free", chars: [makeChar("が", "free", "write", false)] },
          ],
          annotations: [
            { chars: [makeChar("ふ", "annotation", "show", true)] },
          ],
        }),
      ],
    };
    expect(collectCharResults(page).map((c) => c.character)).toEqual([
      "学",
      "が",
      "ふ",
    ]);
    expect(
      collectCharResults(page, {
        sources: ["guided"],
        completedOnly: true,
      }).map((c) => c.character),
    ).toEqual(["学"]);
  });

  it("skips entries whose source/mode is undefined when filtering", () => {
    // Char.result() called standalone leaves source/mode undefined.
    // Such entries shouldn't slip through a sources / modes filter.
    const block = makeBlock({
      cells: [
        {
          kind: "guided",
          chars: [
            {
              character: "学",
              complete: true,
              matched: true,
              perStroke: [],
              // source / mode missing on purpose
            },
          ],
        },
      ],
    });
    expect(collectCharResults(block, { sources: ["guided"] })).toEqual([]);
    expect(collectCharResults(block, { modes: ["write"] })).toEqual([]);
    // No filter → still returned.
    expect(collectCharResults(block)).toHaveLength(1);
  });
});
