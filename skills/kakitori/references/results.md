# Results and restore

How to collect, persist, and replay kakitori results. The data model is intentionally plain (no methods, no DOM refs) so results can be serialized, shipped over the wire, and rendered back at any size.

## The result tree

```
PageResult
├── blocks: BlockResult[]
│   ├── cells: BlockCellResult[]
│   │   └── chars: CharResult[]          ← the leaf type
│   └── annotations: BlockAnnotationResult[]
│       └── chars: CharResult[]
```

Every `.result()` method returns a snapshot. The shapes mirror the input spec, not the rendered DOM, so they round-trip cleanly through `JSON.stringify` / `JSON.parse`.

## `CharResult` (the leaf)

```ts
interface CharResult {
  character: string;
  complete: boolean;          // every logical stroke observed
  matched: boolean;           // every observed stroke matched; vacuously true before any observed
  perStroke: CharStrokeResult[];
  mistakes?: number;                  // guided only, cumulative
  strokeEndingMistakes?: number;      // guided only
  similarity?: number;                // free / annotation only
  candidate?: string;                 // free / annotation only ("which expected string locked in")
  source?: "guided" | "free" | "annotation";   // set when coming through a Block / Page tree
  mode?: "write" | "show";                     // set when coming through a Block / Page tree
}

interface CharStrokeResult {
  matched: boolean;
  similarity: number;          // [0, 1]
  strokeEnding?: StrokeEndingResult;
  points?: TimedPoint[];       // raw drawn samples, in internal 1024 coords
  mistakesOnStroke?: number;   // guided only
  isBackwards?: boolean;       // guided only
}
```

Notes worth surfacing to the user:

- **`complete` vs `matched`** are independent. `complete: true, matched: false` = "done with failures". `complete: false, matched: true` = "still in progress, no failures yet".
- **`perStroke.points`** is always in internal 1024 coords. Y is up, baseline at 0, range `x ∈ [0, 1024]` and `y ∈ [-124, 900]`. Same shape from the mounted quiz and from headless `Char.checkStroke`. See `references/matcher.md` for why.
- **`source` and `mode`** are populated only when the result came through a `Block` / `Page` tree. Standalone `Char.result()` leaves them undefined.
- **Show-mode entries** always come back `complete: true` with an empty `perStroke`. They are display-only and never accept input.

## `BlockResult`

```ts
interface BlockResult {
  id?: string;                       // echoed from PageBlockEntry.id when via page
  complete: boolean;
  matched: boolean;
  cells: BlockCellResult[];
  annotations: BlockAnnotationResult[];
}

interface BlockCellResult {
  kind: "guided" | "free" | "blank";
  chars: CharResult[];               // guided=1, free=expected length, blank=0
  span?: number;                     // when display span > chars.length (e.g. free cell with explicit span)
}

interface BlockAnnotationResult {
  chars: CharResult[];               // one per expected character
  cellRange?: [number, number];      // copied from the spec; restore uses it
  placement?: "top" | "bottom" | "left" | "right";
  sizeRatio?: number;
}
```

`blank` cells exist only for layout (visual placeholder). They produce zero `CharResult` entries — they're not skipped in the array, they just contribute `chars: []`. The cell's display span is preserved via `span` so a `block.restore` can reproduce it.

## `PageResult`

```ts
interface PageResult {
  complete: boolean;
  matched: boolean;
  blocks: BlockResult[];             // mirrors opts.blocks order
}
```

`blocks[i].id` is populated from `PageBlockEntry.id` when one was supplied — use it for stable correlation against your input rather than indexing.

## `collectCharResults`

Flatten any subtree into a flat `CharResult[]`. Filter by source / mode / completion.

```ts
function collectCharResults(
  root: CharResult | BlockResult | PageResult,
  opts?: {
    sources?: ("guided" | "free" | "annotation")[];
    modes?: ("write" | "show")[];
    completedOnly?: boolean;
  },
): CharResult[];
```

Common usages:

```ts
// All writable cells across the page that have completed:
collectCharResults(p.result(), { modes: ["write"], completedOnly: true });

// Only the guided write cells (drop free cells and annotations):
collectCharResults(p.result(), { sources: ["guided"], modes: ["write"] });

// Furigana hits / misses:
collectCharResults(p.result(), { sources: ["annotation"] });
```

The order is deterministic: top-to-bottom across the tree, in the order the user-supplied spec lists cells / annotations / blocks.

## Persisting and replaying

The shape is JSON-safe end to end:

```ts
const snapshot = JSON.stringify(p.result());
localStorage.setItem("session", snapshot);

const restored = JSON.parse(localStorage.getItem("session")!) as PageResult;
page.restore(target, restored, {
  columns: 3,
  cellsPerColumn: 3,
  cellSize: 100,                 // can differ from the original cellSize
});
```

Because `perStroke.points` are in internal 1024 coords, you can restore at any cellSize and the strokes scale proportionally. This is the same property the site's sizing demo exposes for live writers — `result.points` does not depend on display size.

### Three restore APIs

```ts
char.restore(target, charResult, { size, ... });
block.restore(target, blockResult, { cellSize, ... });
page.restore(target, pageResult, { columns, cellsPerColumn, cellSize, ... });
```

All three are pure renderers — no matcher, no quiz state. They just re-paint the captured strokes plus the surrounding chrome (border, grid, outline, optional reference character).

### Visual knobs at restore time

`RestoreOptions` / `BlockRestoreOptions` / `PageRestoreOptions` accept the same display knobs the live equivalents do:

```ts
{
  // pen / colors
  drawingWidth, drawingColor,
  okColor, ngColor,         // colors per match outcome (override drawingColor)

  // chrome
  showGrid,                  // boolean | GridOptions
  showCharacter,             // paint the reference character behind the user's ink
  showOutline,               // faint reference outline
  strokeColor, outlineColor,
}
```

- `showCharacter` defaults to `false` for `write` mode results and `true` for `show` mode results (otherwise show-mode cells would be empty).
- `okColor` / `ngColor` default to `drawingColor` — set them explicitly to color-code strokes by their match verdict.

### Loaders at restore time

The reference character / outline needs hanzi-writer character data, so `charDataLoader` is honored at restore time too. Reuse a memoized loader to keep restore cheap; results restored across many cellSize values for the same character only need to fetch data once.

## Captured points lie in 1024 coords (and what to do with them)

`CharStrokeResult.points` is `TimedPoint[]`:

```ts
interface TimedPoint { x: number; y: number; t: number; }   // t = ms since stroke start
```

The shape is the same whether the points came from a mounted quiz or from headless `Char.checkStroke`. You can:

- **Replay** them: feed the array back into `Char.checkStroke(points)` with NO `sourceBox` (since they're already internal-coord), and you'll get the same `CharStrokeResult` (modulo nondeterminism in hanzi-writer's matcher? — none currently observed).
- **Visualize** them: draw them alongside the medians from `@k1low/hanzi-writer-data-jp`, which use the same 1024 system. No projection math needed.
- **Aggregate** them: stroke duration is `t[last] - t[first]`; stroke speed is path length divided by duration. All in 1024 units.

If you want to ship the array to a server, it's already plain JSON; no encoding needed.
