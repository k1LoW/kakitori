---
name: kakitori
description: Build handwriting practice features for kanji, kana, and numbers using the @k1low/kakitori library. Covers the char / block / page primitives, common recipes (interactive writer, multi-cell blocks with furigana, vertical-rl practice sheets, score collection, restoring saved results), correction modes (per-stroke, per-char, per-block, per-page), the underlying hanzi-writer matcher (leniency, tome / hane / harai stroke endings), and the validation rules that turn silent matcher breakage into actionable errors. Use whenever the user mentions kakitori or @k1low/kakitori, wants to build a kanji / kana / number handwriting practice UI, asks about per-stroke / per-character stroke checking, tome / hane / harai detection, furigana annotations on a practice cell row, vertical-rl Japanese practice-sheet layouts, or how to score / save / replay handwriting results — even if they do not name the library explicitly. Prefer this skill over generic advice whenever any of those topics come up; without it Claude has no way to know the actual option names, callback shapes, or validation guards.
---

# kakitori

A handwriting practice library for kanji, kana, and numbers. Wraps [hanzi-writer](https://github.com/chanind/hanzi-writer) with per-stroke tome / hane / harai detection, composable practice problems, and a paper-style multi-block layout. Published as `@k1low/kakitori` on npm; stroke data is loaded from `@k1low/kakitori-data` (via unpkg by default).

Use this skill when helping the user build any feature that involves writing or judging Japanese characters interactively in the browser. The library is browser-only (it needs DOM + pointer events); there is no Node-side runtime.

## Mental model (the only one you need)

Three primitives, each composing into the next:

```
char   one character          -- render statically | mount an interactive writer | judge headlessly
block  one practice problem   -- a row of cells (guided | free | blank) + optional furigana strip
page   one practice sheet     -- a vertical-rl grid of blocks, with shared correction across blocks
```

Every primitive's `.result()` ultimately yields `CharResult` leaves. `char.result()` returns a single `CharResult`; `block.result()` returns a `BlockResult` whose cells / annotations carry `CharResult[]`; `page.result()` returns a `PageResult` aggregating those blocks. `collectCharResults()` flattens a `BlockResult` or `PageResult` tree (not a bare `CharResult`) and filters by `sources` (`guided` / `free` / `annotation`) and `modes` (`write` / `show`).

## Decide which primitive to use

| Need | Use |
|---|---|
| Show one character (interactive write quiz, animation, or static SVG) | `char` |
| Show one practice problem: a row of cells, optionally with furigana on top | `block` |
| Show a whole practice sheet that flows column-by-column with multiple problems | `page` |
| Judge a saved stroke array without rendering anything | `char.create(...).checkStroke(...)` (headless) |
| Render a previously captured result back into pixels at any size | `char.restore` / `block.restore` / `page.restore` |

When in doubt, lean toward the smallest primitive that fits — block is not "char plus furigana"; it owns its own layout and cell-types, and only goes inside `page` for multi-problem sheets.

## Setup

```bash
npm install @k1low/kakitori
```

```ts
import { char } from "@k1low/kakitori";
import { block } from "@k1low/kakitori/block";
import { page } from "@k1low/kakitori/page";
import { collectCharResults } from "@k1low/kakitori";
```

The library is browser-only. Make sure the target element is in the DOM before calling `.mount()` / `.create()`; the matcher needs measurable layout.

## 30-second quick reference

**Interactive char writer** (quiz the user on one character):

```ts
const c = char.create("学");
c.mount(target, {
  size: 300,
  drawingWidth: 6,
  onCorrectStroke: (d) => console.log("OK stroke", d.strokeNum),
  onMistake: (d) => console.log("NG stroke", d.strokeNum),
  onComplete: (r) => console.log("done", r.totalMistakes, r.matched),
});
c.start();
```

**Multi-cell block with furigana** (a practice problem):

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
  onBlockComplete: (result) => { /* whole problem done */ },
});
```

**Vertical-rl practice page** (flows column-by-column):

```ts
page.create(target, {
  writingMode: "vertical-rl",
  columns: 5,
  cellsPerColumn: 8,
  cellSize: 96,
  blocks: [
    { id: "q1", spec: { cells: [{ kind: "guided", char: "山", mode: "write" }] } },
    // ...
  ],
  onPageComplete: (r) => console.log(r),
});
```

**Score collection across a result tree**:

```ts
const allGuidedWrite = collectCharResults(p.result(), {
  sources: ["guided"],
  modes: ["write"],
  completedOnly: true,
});
const okRate = allGuidedWrite.filter(c => c.matched).length / allGuidedWrite.length;
```

## When to read which reference

Each reference is short and focused; read the one closest to the user's task.

| File | When to read |
|------|--------------|
| `references/api.md` | Full option names + signatures + Char / Block / Page method tables. Read first when answering "what options does X take" / "what does Y callback receive" |
| `references/recipes.md` | Common patterns (single-char quiz, show-then-write, free cells, mixed-mode blocks, page with correction levels, save → restore round trip). Read first when the user wants concrete code |
| `references/correction.md` | per-stroke / per-char / per-block / per-page semantics. Read when the user asks about correction timing, retries, NG wipe behavior, or `maxRetries` |
| `references/matcher.md` | hanzi-writer leniency internals, the 5 AND checks, tome / hane / harai, why a stroke is being accepted / rejected. Read when debugging stroke judgment, or when the user is tuning `leniency` / `strokeEndingStrictness` |
| `references/results.md` | `CharResult` / `BlockResult` / `PageResult` shapes, `collectCharResults`, and the `char.restore` / `block.restore` / `page.restore` flow for replaying captured results at any size. Read when the user needs to save scores, persist user work, or render past results |

These files exist as siblings to this `SKILL.md`. Cite the exact file path back to the user when you reference one (`references/api.md`) so they can open it.

## Top pitfalls (memorize these)

These come from real validation guards inside kakitori; surface the error message itself to the user so they can grep it.

1. **`leniency`, `freeCellLeniency`** must be a finite positive number. `block.create()` and `page.create()` validate them at the entry point (including per-cell `overrides.leniency` on guided cells) and reject `0`, negatives, `NaN`, `Infinity`. `char.create()` itself currently does NOT validate `leniency` and forwards whatever value it gets straight to hanzi-writer, so callers wiring `char.create` directly must sanitize first; everything via block / page is already guarded. Higher = more permissive, lower = stricter. See `references/matcher.md` for what each value actually does.
2. **`free` cell `span`** must be `>= max(expected.length)` if set. If `expected: ["学校", "がっこう"]` (longest = 4 chars), `span` defaults to 4; setting `span: 2` throws.
3. **Annotations cover `span: 1` cells only.** A furigana strip across cells with `span > 1` (free cells in particular) throws — annotated cells must be guided cells or 1-slot free cells.
4. **`writingMode: "vertical-rl"`** allows `annotation.placement: "right"` only; `"horizontal-tb"` allows `"top"` only. Other placements throw.
5. **Page layout**: `columns × cellsPerColumn` is a hard ceiling. A block whose cells exceed the remaining capacity in the current column splits to the next column automatically (annotations are sliced per cell range), but the total cell count across all blocks must fit; oversize layouts throw at `page.create`.
6. **DOM presence**: the target element must be attached and measurable. Mounting into a `display: none` element or a detached node leaves the matcher with zero-sized pointer geometry; nothing breaks visibly, but strokes land in the wrong cell.

## Knobs that look similar but are different

These names trip people up. When the user mentions one, double-check they want the right one.

| What they want | Knob to set |
|---|---|
| "Be more lenient about how the stroke looks" | `leniency` (1.0 default; > 1 more permissive) |
| "Be more lenient about tome / hane / harai endings" | `strokeEndingStrictness` (0.7 default; > 0.7 stricter, < 0.7 looser; **opposite direction** from leniency) |
| "Keep the user's own ink on screen" | `retainStrokes: true` (paper-like UX, often paired with `showAcceptedStroke: false`) |
| "Don't show the gray accepted stroke" | `showAcceptedStroke: false` |
| "Don't show the faint outline behind the stroke" | `showOutline: false` |
| "Don't show the cross-grid" | `showGrid: false` |
| "Don't show the reference character" | `showCharacter: false` |
| "Free-cell stroke threshold should be different from guided" | `freeCellLeniency` (separate from `leniency`) |
| "Wipe and re-arm on NG" | `correction: "per-char"` (or higher) + `maxRetries` |
| "All cells in a block finalize together" | `correction: "per-block"` at block level |
| "All blocks on the page finalize together" | `correction: "per-page"` at page level |

## Result data lives in 1024 internal coords

A subtle but important property worth mentioning when the user wants to save / replay strokes:

`CharResult.perStroke[i].points` (the captured user samples) are always stored in hanzi-writer's internal coordinate system: `x ∈ [0, 1024]`, `y ∈ [-124, 900]` (Y-up, baseline at 0). This holds whether the cell was mounted at `size: 80` or `size: 280`, and whether the result came from the interactive quiz or from `Char.checkStroke()` headless.

This means a `CharResult` is portable: serialize it (it's plain JSON), persist it, then `char.restore(target, result, { size: 160 })` redraws it at whatever new size the new page uses. The same property extends through `block.restore` and `page.restore` — the layout is reproduced at the new `cellSize`. See `references/results.md` for the full save → restore round trip.

## What this skill does NOT cover

- `@k1low/kakitori-data` CLI tools for building stroke-ending datasets. These are author-side tooling for the project itself, not for library consumers.
- React / Vue / Svelte wrappers. None exist as of this writing; integration is via plain DOM elements you hand to `.mount()` / `.create()`. The user owns the framework binding.
- Server-side rendering. Browser only.
- Other language support (the data set is Japanese-specific).

If the user asks about one of these, say so directly rather than guessing.
