# kakitori API reference

Full surface for `@k1low/kakitori`. Each section corresponds to one primitive (`char`, `block`, `page`) plus shared types. Source of truth: `packages/core/src/index.ts`.

## Top-level imports

```ts
// char primitive + types
import {
  char,
  type Char,
  type CharCreateOptions,
  type MountOptions,
  type CharCheckStrokeOptions,
  type CharResult,
  type CharStrokeResult,
  type CharLogger,
  type ConfigLoaderFn,
  type CharDataLoaderFn,
  type RenderOptions,
  type RestoreOptions,
  type GridOptions,
} from "@k1low/kakitori";

// block primitive + types (separate subpath)
import {
  block,
  type Block,
  type BlockCreateOptions,
  type BlockResult,
  type BlockSpec,
  type Cell,
  type GuidedCell,
  type FreeCell,
  type BlankCell,
  type FuriganaAnnotation,
  type BlockRestoreOptions,
  type WritingMode,
} from "@k1low/kakitori/block";

// page primitive + types (separate subpath)
import {
  page,
  type Page,
  type PageCreateOptions,
  type PageBlockEntry,
  type PageResult,
  type PageRestoreOptions,
} from "@k1low/kakitori/page";

// shared utilities
import {
  checkStrokeEnding,         // headless stroke-ending checker
  collectCharResults,        // flatten a result tree
  defaultCharDataLoader,
  defaultConfigLoader,
  HANZI_PRESCALED_SIZE,      // 1024
  HANZI_Y_MAX, HANZI_Y_MIN,  // 900, -124
  HANZI_Y_BASELINE_OFFSET,
  charSets,                  // built-in character lists
  number, hiragana, katakana,
  grade1, grade2, grade3, grade4, grade5, grade6, juniorHigh,
} from "@k1low/kakitori";

// shared types
import type {
  StrokeEndingType,    // "tome" | "hane" | "harai"
  StrokeEnding,
  StrokeEndingResult,
  CharStrokeData,
  TimedPoint,
} from "@k1low/kakitori";
```

---

## `char`

### `char.create(character, opts?): Char`

Builds a `Char` instance. No DOM is touched yet. Mount it, animate it, render it statically, or judge strokes headlessly.

```ts
const c = char.create("学", {
  charDataLoader,           // optional custom loader (default = unpkg @k1low/kakitori-data)
  configLoader,             // null = disable auto-loading of strokeEndings / strokeGroups
  strokeGroups,             // number[][], maps logical strokes to data stroke indices
  leniency,                 // number, multiplier on matcher tolerance (default 1)
  strokeEndingStrictness,   // number in [0, 1], tome/hane/harai strictness (default 0.7)
  logger,                   // (msg: string) => void
});
```

### `char.render(target, character, opts?): void`

Static SVG render. No interaction.

```ts
char.render(target, "学", {
  size: 80,
  padding,
  strokeColor,
  showGrid,            // boolean | GridOptions, default true
  charDataLoader,
  onClick: ({ character }) => { /* click handler */ },
});
```

### `char.restore(target, result, opts): void`

Render a captured `CharResult` back into pixels. See `references/results.md`.

### `Char` methods (the important ones)

```ts
interface Char {
  el: HTMLElement | null;        // mounted target, or null when headless
  ready(): Promise<void>;        // resolves once strokeEndings / strokeGroups / char-data loaded
  checkStroke(points: TimedPoint[], opts?: CharCheckStrokeOptions): CharStrokeResult;
  check(): Char;                 // run correction for "deferred" mode (block / page coordinator)
  result(): CharResult;
  getStrokeEndings(): readonly StrokeEnding[] | null;
  setStrokeEndings(s: StrokeEnding[]): Char;
  getStrokeGroups(): readonly number[][] | null;
  setStrokeGroups(g: number[][]): Char;
  getLogicalStrokeCount(): number;
  setCharacter(c: string): Promise<Char>;

  mount(target: string | HTMLElement, mountOpts?: MountOptions): Char;
  unmount(): Char;
  isMounted(): boolean;

  start(): Char;                 // arm the quiz / start accepting input
  animate(): Char;               // play the reference stroke animation
  reset(): Char;                 // wipe state, ready for a new start()
  undo(): Char;                  // undo last stroke (per-stroke mode)

  // visibility toggles
  hideCharacter(): Char; showCharacter(): Char;
  showOutline(): Char;   hideOutline(): Char;

  // click-to-highlight
  setStrokeColor(logicalStrokeNum: number, color?: string): Char;
  resetStrokeColor(logicalStrokeNum: number): Char;
  resetStrokeColors(): Char;
  getStrokeIndexAtPoint(clientX: number, clientY: number): number | null;

  destroy(): void;               // tear down, release event listeners
}
```

### `CharCreateOptions` (recap)

```ts
interface CharCreateOptions {
  logger?: CharLogger;
  configLoader?: ConfigLoaderFn | null;
  charDataLoader?: CharDataLoaderFn;
  strokeGroups?: number[][];
  leniency?: number;
  strokeEndingStrictness?: number; // 0..1, default 0.7
}
```

### `MountOptions` (the big one)

```ts
interface MountOptions {
  // Geometry
  size?: number;
  padding?: number;
  // Pen / display
  drawingWidth?: number;             // display px, size-independent, default 4
  drawingColor?: string;
  retainStrokes?: boolean;           // keep user ink after accept (paper feel)
  retainedStrokeColor?: string;
  retainedStrokeWidth?: number;
  showAcceptedStroke?: boolean;      // default true; false hides hanzi-writer's gray accepted stroke
  showGrid?: boolean | GridOptions;  // default true
  showOutline?: boolean;
  showCharacter?: boolean;
  strokeColor?: string;
  outlineColor?: string;
  highlightColor?: string;

  // Matcher / correction
  correction?: "per-stroke" | "per-char" | "deferred";  // default "per-stroke"
  onCharCaptured?: (captures: ReadonlyArray<ReadonlyArray<TimedPoint>>) => void;
  maxRetries?: number;                // undefined = unlimited, 0 = no retries
  onCharRejected?: (data: {
    character: string;
    totalMistakes: number;
    strokeEndingMistakes: number;
    attempts: number;
  }) => void;

  // Quiz behavior
  strokeAnimationSpeed?: number;
  delayBetweenStrokes?: number;
  showHintAfterMisses?: number | false;  // default 3
  highlightOnComplete?: boolean;
  strokeEndingAsMiss?: boolean;          // tome/hane/harai NG = full miss

  // Callbacks
  onCorrectStroke?: (data: CharStrokeData) => void;
  onStrokeEndingMistake?: (data: CharStrokeData) => void;
  onMistake?: (data: CharStrokeData) => void;
  onComplete?: (data: {
    character: string;
    totalMistakes: number;
    strokeEndingMistakes: number;
    matched: boolean;
    attempts: number;
  }) => void;
  onClick?: (data: { character: string; strokeIndex: number | null }) => void;
}
```

### `CharStrokeData` (callback payload)

```ts
interface CharStrokeData {
  character: string;
  strokeNum: number;              // 0-indexed logical stroke
  mistakesOnStroke: number;       // per-stroke mistake count (guided)
  totalMistakes: number;          // cumulative across the char
  strokeEndingMistakes: number;
  strokeEnding?: StrokeEndingResult;   // tome / hane / harai verdict
  points: ReadonlyArray<TimedPoint>;   // raw samples in internal 1024 coords
  isBackwards?: boolean;
}
```

### `CharCheckStrokeOptions` (headless judging)

`sourceBox` lets you feed strokes in any consistent coordinate system; kakitori projects them into hanzi-writer's internal coords. Omit to feed pre-projected internal-coord points.

---

## `block`

### `block.create(target, opts): Block`

Builds a multi-cell practice problem.

```ts
block.create(target, {
  spec: { cells, annotations?, size? },
  cellSize,                       // required, display px
  writingMode?,                   // "vertical-rl" | "horizontal-tb", default "vertical-rl"
  showGrid?,                      // boolean | GridOptions
  cellBorderWidth?, cellBorderColor?,
  drawingWidth?, drawingColor?,
  annotationDrawingWidth?,
  annotationThickness?,
  leniency?,                      // block-wide, forwarded to every guided cell
  freeCellLeniency?,              // separate threshold for free cells / annotations
  retainStrokes?, retainedStrokeColor?, retainedStrokeWidth?,
  showAcceptedStroke?,
  correction?,                    // "per-stroke" | "per-char" | "per-block" | "deferred"
  maxRetries?,
  loaders?: { charDataLoader?, configLoader? | null },
  onCellComplete?: (index, kind: "cell" | "annotation", chars: CharResult[]) => void,
  onBlockComplete?: (result: BlockResult) => void,
  onBlockCaptured?: () => void,   // "deferred" mode hook
  onBlockRejected?: () => void,
  onActivity?: () => void,        // any user input observed
});
```

### `BlockSpec` types

```ts
type Cell = GuidedCell | FreeCell | BlankCell;

interface GuidedCell {
  kind: "guided";
  char: string;                       // single character to write or show
  mode: "write" | "show";
  overrides?: Partial<CharCreateOptions> & Partial<MountOptions>;
  // per-cell options override block-wide / page-wide ones
}

interface FreeCell {
  kind: "free";
  expected: string | string[];        // accepted answer(s), freehand-matched
  mode: "write" | "show";
  span?: number;                      // grid slots reserved; defaults to longest expected length
}

interface BlankCell {
  kind: "blank";
  span?: number;                      // grid slots reserved; default 1
}

interface FuriganaAnnotation {
  cellRange: [number, number];        // inclusive, into spec.cells
  expected: string | string[];
  mode: "write" | "show";
  placement?: "top" | "bottom" | "left" | "right";  // see writingMode rules in pitfalls.md
  sizeRatio?: number;                 // 0..1; thickness relative to cellSize
}
```

### `Block` methods

```ts
interface Block {
  el: HTMLElement;
  reset(): void;
  undo(): { kind: "cell" | "annotation"; index: number } | null;
  result(): BlockResult;
  check(): void;                      // burst-finalize for "deferred" mode
  destroy(): void;
}
```

### `BlockResult`

```ts
interface BlockResult {
  id?: string;                        // populated by page.create via PageBlockEntry.id
  complete: boolean;                  // every writable cell + annotation completed
  matched: boolean;                   // every observed CharResult.matched
  cells: BlockCellResult[];
  annotations: BlockAnnotationResult[];
}

interface BlockCellResult {
  kind: "guided" | "free" | "blank";
  chars: CharResult[];                // guided=1, free=expected length, blank=0
  span?: number;                      // present when display span != chars.length
}

interface BlockAnnotationResult {
  chars: CharResult[];                // one per expected character
  cellRange?: [number, number];
  placement?: "top" | "bottom" | "left" | "right";
  sizeRatio?: number;
}
```

### `block.restore(target, blockResult, opts)`

```ts
interface BlockRestoreOptions {
  cellSize: number;                   // required
  writingMode?: WritingMode;
  padding?, cellBorderWidth?, cellBorderColor?,
  showAnnotationStrip?: boolean,
  annotationStripThickness?: number,
  drawingWidth?, drawingColor?,
  showGrid?, showCharacter?, showOutline?,
  strokeColor?, outlineColor?, okColor?, ngColor?,
  charDataLoader?,
}
```

---

## `page`

### `page.create(target, opts): Page`

Lays out multiple blocks on a Japanese practice-sheet grid.

```ts
page.create(target, {
  columns,                         // required
  cellsPerColumn,                  // required
  cellSize,                        // required
  writingMode?,                    // default "vertical-rl"
  showAnnotationStrip?,            // default true
  annotationStripThickness?,
  showGrid?,
  loaders?: { charDataLoader?, configLoader? | null },
  drawingColor?, matchedColor?, drawingWidth?, annotationDrawingWidth?,
  cellBorderWidth?, cellBorderColor?,
  freeCellLeniency?,
  leniency?,                       // page-wide; per-cell overrides still win
  retainStrokes?, retainedStrokeColor?, retainedStrokeWidth?,
  showAcceptedStroke?,
  correction?,                     // "per-stroke" | "per-char" | "per-block" | "per-page"
  maxRetries?,
  logger?, showSegmentBoxes?, segmentBoxColor?,
  blocks: ReadonlyArray<{ id?: string; spec: BlockSpec }>,
  onCellComplete?: (blockIndex, index, kind, chars) => void,
  onBlockComplete?: (blockIndex, result: BlockResult) => void,
  onPageComplete?: (result: PageResult) => void,
});
```

### `Page` methods

```ts
interface Page {
  el: HTMLElement;
  reset(): void;
  undo(): PageUndoResult;
  result(): PageResult;
  check(): void;                      // burst-finalize for "per-page" deferral
  destroy(): void;
}
```

### `PageResult`

```ts
interface PageResult {
  complete: boolean;
  matched: boolean;
  blocks: BlockResult[];              // mirrors opts.blocks order; each has id set to PageBlockEntry.id
}
```

### `page.restore(target, pageResult, opts)`

```ts
interface PageRestoreOptions {
  columns: number;
  cellsPerColumn: number;
  cellSize: number;
  writingMode?,
  // ... same visual knobs as PageCreateOptions
}
```

---

## `collectCharResults`

Flattens a result tree into a flat `CharResult[]`.

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

Common patterns:

```ts
// All guided write cells across a page, only completed ones
collectCharResults(p.result(), { sources: ["guided"], modes: ["write"], completedOnly: true });

// Only the furigana annotations
collectCharResults(p.result(), { sources: ["annotation"] });

// Everything the user wrote (any source) and finished
collectCharResults(p.result(), { modes: ["write"], completedOnly: true });
```

## Stroke ending types (`tome` / `hane` / `harai`)

```ts
type StrokeEndingType = "tome" | "hane" | "harai";

interface StrokeEnding {
  /** Which logical stroke this applies to. */
  strokeNum: number;
  /** Acceptable ending types (a stroke may legitimately end multiple ways). */
  types: StrokeEndingType[];
}

interface StrokeEndingResult {
  expected: StrokeEndingType[];
  observed: StrokeEndingType | null;
  correct: boolean;
}
```

`checkStrokeEnding(points, expected, opts?)` is the headless ending judge; the mounted quiz uses it internally and surfaces results through `CharStrokeData.strokeEnding` and `onStrokeEndingMistake`.

## Character sets

Pre-built character lists you can iterate over to build practice gallery UIs.

```ts
import { charSets, number, hiragana, katakana, grade1, juniorHigh } from "@k1low/kakitori";

// charSets is the object form: { number, hiragana, katakana, grade1..grade6, juniorHigh }
for (const [key, chars] of Object.entries(charSets)) {
  console.log(key, chars.length);
}
```

## Constants

```ts
import {
  DEFAULT_SIZE,            // typical default cell size
  DEFAULT_PADDING,
  DEFAULT_DRAWING_WIDTH,   // 4
  HANZI_PRESCALED_SIZE,    // 1024
  HANZI_Y_MAX,             // 900
  HANZI_Y_MIN,             // -124
  HANZI_Y_BASELINE_OFFSET,
} from "@k1low/kakitori";
```

These define hanzi-writer's internal coordinate system. `CharResult.perStroke[i].points` always live in this 1024-scale space (Y-up; y=0 is the baseline). See `references/results.md`.
