# kakitori

A TypeScript library for kanji handwriting practice. Wraps [Hanzi Writer](https://github.com/chanind/hanzi-writer) with per-stroke tome / hane / harai judgment, composable practice problems, and a paper-style multi-block layout.

## Site

https://k1low.github.io/kakitori/

## About

kakitori uses [@k1low/hanzi-writer-data-jp](https://github.com/k1LoW/hanzi-writer-data-jp) for character data and is built around three primitives:

- **`char`** — one character. Render statically, mount an interactive writer that judges each stroke, or judge strokes headlessly without a DOM.
- **`block`** — one practice problem: a row of cells plus an optional furigana annotation strip. Cells can be guided (one specific character to write or show), free (any of an expected string, matched freehand), or blank (visual placeholder).
- **`page`** — a vertical-rl grid of multiple blocks (Japanese practice-sheet style). Blocks flow column-by-column; a block that crosses a column boundary is split per-cell automatically, even when it carries a furigana annotation, and strokes drawn across split surfaces are judged from a shared buffer.

Features:
- Stroke ending judgment: tome (stop), hane (hook), harai (sweep)
- Stroke grouping to correct stroke counts (e.g. "あ" has 4 data strokes but 3 actual strokes)
- animCJK-style stroke animation with seamless grouped strokes
- Click-to-select stroke highlighting
- Logger for debugging pointer events and judgment results
- Unified `CharResult` leaf across all primitives, flattenable via `collectCharResults()`

## Packages

| Package | Description |
|---------|-------------|
| [@k1low/kakitori](./packages/core) | Core library: char / block / page primitives + per-stroke tome / hane / harai judgment |
| [@k1low/kakitori-data](./packages/data) | Stroke ending (tome / hane / harai) + stroke grouping data, plus CLI tools |

## Usage

### char

```ts
import { char } from "@k1low/kakitori";

// Mount an interactive writer that judges each stroke.
const target = document.getElementById("writer")!;
const c = char.create("学");
c.mount(target, {
  size: 300,
  showGrid: true,
  onCorrectStroke: (data) => console.log("OK", data.strokeNum),
  onMistake: (data) => console.log("NG", data.strokeNum),
  onComplete: ({ totalMistakes }) => console.log("done", totalMistakes),
});
c.start();

// Static SVG render with no interaction.
char.render(document.getElementById("preview")!, "学", { size: 80 });
```

### block

```ts
import { block } from "@k1low/kakitori/block";

const target = document.getElementById("block-host")!;
const b = block.create(target, {
  spec: {
    cells: [
      { kind: "guided", char: "学", mode: "write" },
      { kind: "guided", char: "校", mode: "write" },
    ],
    annotations: [
      { cellRange: [0, 1], expected: "がっこう", mode: "write" },
    ],
  },
  cellSize: 140,
  onCellComplete: (index, kind, chars) => { /* per cell finished */ },
  onBlockComplete: (result) => { /* this problem finished */ },
});

// Get the structured result tree at any time.
const result = b.result();
```

### page

```ts
import { page } from "@k1low/kakitori/page";

const target = document.getElementById("page-host")!;
const p = page.create(target, {
  writingMode: "vertical-rl",
  columns: 5,
  cellsPerColumn: 8,
  cellSize: 96,
  blocks: [
    {
      id: "q1",
      spec: {
        cells: [
          { kind: "guided", char: "学", mode: "write" },
          { kind: "guided", char: "校", mode: "write" },
        ],
        annotations: [
          { cellRange: [0, 1], expected: "がっこう", mode: "show" },
        ],
      },
    },
    { id: "q2", spec: { cells: [{ kind: "guided", char: "山", mode: "write" }] } },
    // ...
  ],
  onBlockComplete: (blockIndex, result) => { /* one problem done */ },
  onPageComplete: (result) => { /* whole sheet done */ },
});
```

### Result tree

Every primitive's `.result()` is composed of `CharResult` leaves. `collectCharResults` flattens a `BlockResult` or `PageResult` tree and filters by `sources` / `modes` / `completedOnly`:

```ts
import { collectCharResults } from "@k1low/kakitori";

const scored = collectCharResults(p.result(), {
  sources: ["guided"],
  modes: ["write"],
  completedOnly: true,
});
```

## License

MIT
