# kakitori recipes

Copy-paste-friendly snippets for common tasks. All examples assume `target` is a real DOM element already attached to the document.

## 1. Single character quiz with score readout

```ts
import { char } from "@k1low/kakitori";

const c = char.create("学");
c.mount(target, {
  size: 300,
  drawingWidth: 6,
  showHintAfterMisses: 3,
  onCorrectStroke: (d) => console.log("OK", d.strokeNum + 1, d.strokeEnding),
  onMistake:       (d) => console.log("NG", d.strokeNum + 1),
  onComplete: ({ totalMistakes, strokeEndingMistakes, matched }) => {
    console.log({ totalMistakes, strokeEndingMistakes, matched });
  },
});
c.start();
```

## 2. Show first, then write (trace-then-write)

Two cells, side by side: the left renders the character (read-only), the right is the writable target.

```ts
import { block } from "@k1low/kakitori/block";

block.create(target, {
  spec: {
    cells: [
      { kind: "guided", char: "学", mode: "show" },
      { kind: "guided", char: "校", mode: "write" },
    ],
  },
  cellSize: 140,
});
```

## 3. Free cell with multiple acceptable answers

`expected` accepts either string (single answer) or `string[]` (any of). The cell reserves `span` grid slots — defaults to the longest expected length.

```ts
block.create(target, {
  spec: {
    cells: [
      // user can write either "学校" or "がっこう"
      { kind: "free", expected: ["学校", "がっこう"], mode: "write" },
    ],
  },
  cellSize: 140,
});
```

To hide the answer length, set `span` larger than the longest expected:

```ts
{ kind: "free", expected: "学校", mode: "write", span: 4 }
```

## 4. Block with a furigana annotation strip

```ts
block.create(target, {
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
  // Annotation strip lands on the right by default for vertical-rl,
  // on the top for horizontal-tb. Other placements are rejected.
});
```

## 5. Paper-like UX (user's own ink stays, no gray accepted stroke)

```ts
const c = char.create("学", { leniency: 1.0 });
c.mount(target, {
  size: 240,
  retainStrokes: true,        // keep the user's ink after accept
  showAcceptedStroke: false,  // hide hanzi-writer's gray accepted stroke
});
c.start();
```

This combination is the most paper-like presentation. Without `showAcceptedStroke: false`, the gray reference stroke replaces the user's ink on accept.

## 6. Per-char correction (NG wipes the cell, no per-stroke rejection)

The user freely draws every stroke. Once they've drawn all of them, kakitori judges; on NG it wipes the cell and lets them retry.

```ts
char.create("学").mount(target, {
  size: 240,
  correction: "per-char",
  maxRetries: 2,                                // 3 attempts total (1 + 2 retries)
  onCharRejected: ({ attempts }) => console.log("retry", attempts),
  onComplete: ({ matched, attempts }) => console.log("done", { matched, attempts }),
}).start();
```

`maxRetries: undefined` = unlimited; `maxRetries: 0` = first NG commits as failed.

## 7. Vertical-rl page (Japanese practice-sheet style)

```ts
import { page } from "@k1low/kakitori/page";

page.create(target, {
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
  onBlockComplete: (i, r) => console.log("block", i, r.matched),
  onPageComplete:  (r)    => console.log("page done", r.matched),
});
```

Blocks flow column-by-column. A block that crosses a column boundary is auto-split per-cell (annotations slice along with it), so you do not have to chunk inputs yourself.

## 8. Whole-sheet (per-page) correction

Every writable cell on the page defers its verdict; once every block has captured, the page coordinator burst-fires every callback in one go.

```ts
page.create(target, {
  // ...
  correction: "per-page",
  blocks: [/* ... */],
  onPageComplete: (r) => {
    // r.complete === true once every block + annotation has settled
    // r.matched is the page-wide rollup
  },
});
```

For block-only deferral (per-block but not per-page): pass `correction: "per-block"` at either the block level (when using `block.create` directly) or the page level (forwarded to each block).

## 9. Score collection across a page

```ts
import { collectCharResults } from "@k1low/kakitori";

const r = p.result();
const guidedWriteCompleted = collectCharResults(r, {
  sources: ["guided"],
  modes: ["write"],
  completedOnly: true,
});
const okCount = guidedWriteCompleted.filter(c => c.matched).length;
const accuracy = okCount / guidedWriteCompleted.length;
```

## 10. Save and restore a session

Every result is plain JSON (no methods, no DOM refs). Persist it, ship it across the wire, replay it anywhere.

```ts
// capture
const saved = JSON.stringify(p.result());
localStorage.setItem("lastSession", saved);

// later, on a different page / different cellSize
import { page } from "@k1low/kakitori/page";
const restoredResult = JSON.parse(localStorage.getItem("lastSession")!) as PageResult;
page.restore(target, restoredResult, {
  columns: 3,
  cellsPerColumn: 3,
  cellSize: 100,
});
```

The strokes were captured in hanzi-writer's internal 1024 coords, so `cellSize` at restore time can differ from the original. See `references/results.md` for more on coordinate invariance.

## 11. Headless judging (no visible UI, no quiz lifecycle)

Useful for unit tests or evaluating saved strokes. "Headless" here means no visible UI and no mounted quiz on the host page — `Char.checkStroke` still needs a DOM-capable environment (browser, or a DOM shim like jsdom / happy-dom in tests), because internally it spins up an offscreen hidden hanzi-writer instance attached to `document.body` to drive the matcher.

```ts
const c = char.create("学");
await c.ready();          // wait for char data + strokeGroups / strokeEndings to load
for (const [i, points] of capturedPerStroke.entries()) {
  // checkStroke is async and takes the logical strokeNum first
  const res = await c.checkStroke(i, points);
  console.log(i, res.matched, res.similarity, res.strokeEnding);
}
const full = c.result(); // CharResult with the same shape as a mounted quiz produces
```

Use `CharCheckStrokeOptions.sourceBox` to feed points from a non-internal coordinate system (e.g. raw client coords with a known cell box). Omit `sourceBox` if your points are already in internal 1024 coords (the case for points re-fed from a saved `CharResult`).

## 12. Character gallery (built-in lists)

```ts
import { char, charSets } from "@k1low/kakitori";

for (const [key, chars] of Object.entries(charSets)) {
  // key in: "number" | "hiragana" | "katakana" | "grade1".."grade6" | "juniorHigh"
  for (const ch of chars) {
    const cell = document.createElement("div");
    gallery.appendChild(cell);
    char.render(cell, ch, {
      size: 60,
      onClick: ({ character }) => openPractice(character),
    });
  }
}
```

## 13. Reset / undo / restart

```ts
c.reset();           // wipe state, ready for a fresh start()
c.start();           // re-arm the quiz

c.undo();            // per-stroke mode: undo last stroke
b.undo();            // block: undo most recently active cell or annotation
p.undo();            // page: walks back through most-recently-touched units across blocks
```

## 14. Click-to-highlight a stroke

```ts
c.mount(target, {
  size: 240,
  onClick: ({ strokeIndex }) => {
    if (strokeIndex === null) return;       // click missed every stroke region
    c.resetStrokeColors();
    c.setStrokeColor(strokeIndex, "#c00");
  },
});
```

`onClick` is suppressed entirely by the runtime while a quiz / per-char capture is active, so the callback simply does not fire during writing (no trailing drag-tail click can recolor a just-accepted stroke). When it does fire, `strokeIndex` is the hit stroke's logical index, or `null` if the click landed outside every stroke region.

## 15. Tone down a specific cell (per-cell overrides)

`GuidedCell.overrides` accepts every `CharCreateOptions` and `MountOptions` key. Per-cell overrides win over block-wide / page-wide values.

```ts
block.create(target, {
  spec: {
    cells: [
      { kind: "guided", char: "学", mode: "write" },                          // block-wide leniency
      { kind: "guided", char: "校", mode: "write", overrides: { leniency: 1.5 } }, // looser
      { kind: "guided", char: "永", mode: "write", overrides: { leniency: 0.7 } }, // stricter
    ],
  },
  cellSize: 140,
  leniency: 1.0,
});
```
