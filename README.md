# kakitori

A handwriting practice library for kanji, kana, and numbers. Per-stroke tome / hane / harai checking, composable practice problems, and a paper-style multi-block layout.

## Site

https://k1low.github.io/kakitori/

## About

kakitori uses [@k1low/hanzi-writer-data-jp](https://github.com/k1LoW/hanzi-writer-data-jp) for character data and is built around three primitives:

- **`char`** — one character. Render statically, mount an interactive writer that checks each stroke, or check strokes headlessly without a DOM.
- **`block`** — one practice problem: a row of cells plus an optional furigana annotation strip. Cells can be guided (one specific character to write or show), free (any of an expected string, matched freehand), or blank (visual placeholder).
- **`page`** — a vertical-rl grid of multiple blocks (Japanese practice-sheet style). Blocks flow column-by-column; a block that crosses a column boundary is split per-cell automatically, even when it carries a furigana annotation, and strokes drawn across split surfaces are checked from a shared buffer.

Features:
- Stroke ending check: tome (stop), hane (hook), harai (sweep)
- Stroke grouping to correct stroke counts (e.g. "あ" has 4 data strokes but 3 actual strokes)
- animCJK-style stroke animation with seamless grouped strokes
- Click-to-select stroke highlighting
- Logger for debugging pointer events and check verdicts
- Unified `CharResult` leaf across all primitives, flattenable via `collectCharResults()`

## Packages

| Package | Description |
|---------|-------------|
| [@k1low/kakitori](./packages/core) | Core library: char / block / page primitives + per-stroke tome / hane / harai checking |
| [@k1low/kakitori-data](./packages/data) | Stroke ending (tome / hane / harai) + stroke grouping data, plus CLI tools |

## Usage

### char

```ts
import { char } from "@k1low/kakitori";

// Mount an interactive writer that checks each stroke.
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

## Acknowledgements

Character stroke data is sourced via [@k1low/hanzi-writer-data-jp](https://github.com/k1LoW/hanzi-writer-data-jp), whose data is derived from:

- [animCJK](https://github.com/parsimonhi/animCJK) — LGPL v3 or later ([LGPL.txt](https://github.com/k1LoW/hanzi-writer-data-jp/blob/main/licenses/LGPL.txt))
  - Builds on [Makemeahanzi](https://github.com/skishore/makemeahanzi), which extracts SVG strokes from the Arphic PL KaitiM GB / Big5 fonts generously provided by Arphic Technology Co., Ltd.
- [subAnimJ](https://github.com/k1LoW/subAnimJ) — Arphic Public License ([LICENSE](https://github.com/k1LoW/subAnimJ/blob/main/LICENSE), [ARPHICPL.TXT](https://github.com/k1LoW/hanzi-writer-data-jp/blob/main/licenses/ARPHICPL.TXT))
- [animNumber](https://github.com/k1LoW/animNumber) — SIL Open Font License 1.1 ([OFL.txt](https://github.com/k1LoW/animNumber/blob/main/licenses/OFL.txt))
- [Unihan database](https://www.unicode.org/charts/unihan.html) — Unicode Copyright and Permission Notice ([COPYING.txt](https://github.com/k1LoW/hanzi-writer-data-jp/blob/main/licenses/COPYING.txt))

The full set of upstream licenses lives in the [hanzi-writer-data-jp `licenses/`](https://github.com/k1LoW/hanzi-writer-data-jp/tree/main/licenses) directory.

## License

MIT (for kakitori's own source). Character stroke data is fetched from upstream at runtime and keeps its own license — see the Acknowledgements section above.

### Attribution snippet for downstream sites

If you use kakitori together with [@k1low/hanzi-writer-data-jp](https://github.com/k1LoW/hanzi-writer-data-jp) (the default character data source) on your own site, drop something like the following into your footer or credits page to surface the upstream licensing chain:

```html
<p>
  Character stroke data via
  <a href="https://github.com/k1LoW/hanzi-writer-data-jp" target="_blank" rel="noopener noreferrer">@k1low/hanzi-writer-data-jp</a>,
  derived from
  <a href="https://github.com/parsimonhi/animCJK" target="_blank" rel="noopener noreferrer">animCJK</a>
  (<a href="https://github.com/k1LoW/hanzi-writer-data-jp/blob/main/licenses/LGPL.txt" target="_blank" rel="noopener noreferrer">LGPL v3+</a>;
  built on
  <a href="https://github.com/skishore/makemeahanzi" target="_blank" rel="noopener noreferrer">Makemeahanzi</a>
  / Arphic PL KaitiM fonts by Arphic Technology),
  <a href="https://github.com/k1LoW/subAnimJ" target="_blank" rel="noopener noreferrer">subAnimJ</a>
  (<a href="https://github.com/k1LoW/hanzi-writer-data-jp/blob/main/licenses/ARPHICPL.TXT" target="_blank" rel="noopener noreferrer">Arphic PL</a>),
  <a href="https://github.com/k1LoW/animNumber" target="_blank" rel="noopener noreferrer">animNumber</a>
  (<a href="https://github.com/k1LoW/animNumber/blob/main/licenses/OFL.txt" target="_blank" rel="noopener noreferrer">SIL OFL 1.1</a>),
  and the
  <a href="https://www.unicode.org/charts/unihan.html" target="_blank" rel="noopener noreferrer">Unihan database</a>
  (<a href="https://github.com/k1LoW/hanzi-writer-data-jp/blob/main/licenses/COPYING.txt" target="_blank" rel="noopener noreferrer">Unicode license</a>).
  Full upstream license texts:
  <a href="https://github.com/k1LoW/hanzi-writer-data-jp/tree/main/licenses" target="_blank" rel="noopener noreferrer">hanzi-writer-data-jp/licenses/</a>.
</p>
```
