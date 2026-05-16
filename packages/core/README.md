# @k1low/kakitori

A handwriting practice library for kanji, kana, and numbers. Per-stroke tome / hane / harai judgment, composable practice problems, and a paper-style multi-block layout.

Built around three primitives:

- **`char`** — one character. Render statically, mount an interactive writer that judges each stroke, or judge strokes headlessly without a DOM.
- **`block`** — one practice problem: a row of cells plus an optional furigana annotation strip. Cells can be guided / free / blank.
- **`page`** — a vertical-rl grid of multiple blocks (Japanese practice-sheet style).

See [github.com/k1LoW/kakitori](https://github.com/k1LoW/kakitori) for the full overview and live examples.

## Install

```
npm install @k1low/kakitori hanzi-writer
```

## Usage

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
```

`block` / `page` primitives expose the same per-character `CharResult` leaves; flatten across a tree with `collectCharResults()`.

## License

MIT
