# Correction modes

`correction` controls when the matcher actually evaluates input and how NG attempts are handled. Four values are exposed across the three primitives; they compose hierarchically.

## Values, by primitive

| Mode | `char` (MountOptions) | `block` (BlockCreateOptions) | `page` (PageCreateOptions) |
|---|---|---|---|
| `per-stroke` | yes (default) | yes (forwards to each char) | yes (forwards to each block) |
| `per-char` | yes | yes (forwards to each char) | yes (forwards to each block) |
| `deferred` | yes (internal use; expects external `Char.check()`) | yes (block-level deferred) | n/a |
| `per-block` | no | yes (cells deferred until full block written) | yes (forwards to each block) |
| `per-page` | no | no | yes (every block + cell deferred until the entire page is written) |

Per-cell overrides via `GuidedCell.overrides.correction` win over block / page-wide values.

## Semantics

### `per-stroke` (default)

Each stroke is judged the moment the user lifts the pointer. NG attempts are rejected and the user retries the same stroke. `onMistake` fires per attempt; `onCorrectStroke` fires once the stroke is accepted. After every stroke is accepted, `onComplete` fires with `matched: true`.

This is hanzi-writer's native flow. Live-ink rendering and the stroke hint (`showHintAfterMisses`) are both active.

### `per-char`

The user freely draws every stroke without per-stroke rejection. Once they have completed `getLogicalStrokeCount()` pointerdown→up cycles, kakitori runs correction across the whole character.

- Per-stroke verdicts dispatch via the same callbacks (`onCorrectStroke` for matches, `onMistake` for misses), followed by exactly one `onComplete`.
- `CharStrokeData.mistakesOnStroke` is always `0` (no guided retry counter on this path).
- The cell does not paint hanzi-writer's official strokes during input — kakitori draws each stroke as a raw polyline. `retainStrokes` decides whether those polylines stay after correction (default: cleared on the next `start()`).

On NG, the cell wipes and re-arms. `onCharRejected` fires; `onComplete` is held back until a future attempt lands OK (or `maxRetries` is exhausted, in which case `onComplete` fires with `matched: false`).

### `deferred`

Same capture flow as `per-char` (no per-stroke rejection, polylines drawn as the user drags), but correction does not run automatically when the buffer is full. Instead, `onCharCaptured` fires with the buffered strokes, and the host must call `Char.check()` to actually run correction.

Used by higher-level coordinators (`block.correction: "per-block"`, `page.correction: "per-page"`); rarely needed at the `char` level directly.

### `per-block`

At block level, every guided cell is mounted with `correction: "deferred"`. The block waits until every cell has captured. When the last cell captures, the block fires `onBlockCaptured`, then walks each cell in order, calling `Char.check()` and dispatching the cell's `onCellComplete` synchronously. Finally `onBlockComplete` fires.

NG behavior: if any cell's check lands NG, that single cell wipes and re-arms; the rest stay captured. The block waits for the user to redraw the failed cell. `onBlockRejected` fires per failed cell. `onBlockComplete` only lands once every cell has settled OK (or `maxRetries` for the failed cell is exhausted).

### `per-page`

Page-wide deferral. The page injects block-level `correction: "deferred"` into every block. Once every block has captured, the page coordinator walks each block in order and calls `Block.check()`. Verdicts from all blocks land in one burst. `onPageComplete` fires last.

Show-mode cells and blank cells are not writable inputs — their synthetic `onCellComplete` still fires at create time, and the page just waits on the write-mode cells alongside them.

## `maxRetries` interaction

Available on every `correction` mode that wipes on NG (`per-char`, `per-block`, `per-page`, `deferred`).

- `undefined` (default): unlimited retries — the cell keeps re-arming until OK.
- `0`: no retries — the first NG commits as failed (`onComplete` fires immediately with `matched: false`; `onCharRejected` never fires).
- `N`: up to `N` retries. The `(N + 1)`-th NG attempt commits as failed.

Mistake counters (`totalMistakes`, `strokeEndingMistakes`) accumulate across every attempt, so the final `onComplete` carries the cumulative count. Per-stroke verdicts in `result()` are NOT cumulative — each retry wipes the previous attempt's verdicts, so the final `perStroke` array reflects only the attempt that ultimately settled.

Forwarded down through the hierarchy when set at higher levels:

```
page.maxRetries  →  block.maxRetries (when block does not override)
block.maxRetries →  cell-level maxRetries
cell.overrides.maxRetries  wins over all of the above
```

## Picking a mode

| User-facing behavior | Mode |
|---|---|
| Drill one stroke at a time, fix each error in place | `per-stroke` |
| Write the whole character freely, then get OK/NG | `per-char` |
| Write a full word (multiple cells), then get OK/NG per cell | `per-block` at block level |
| Write the whole sheet, then submit and see the score | `per-page` at page level |

## Common pitfalls

- **`per-stroke` and `retainStrokes`**: `retainStrokes` keeps the user's ink visible after each accepted stroke, but hanzi-writer also paints its own accepted-stroke layer on top. To get the paper-only feel, pair with `showAcceptedStroke: false`.
- **`per-char` with `maxRetries: 0`**: the first NG commits as failed and `onCharRejected` never fires. If you want a "one chance" UX that still surfaces the rejection, set `maxRetries: 1` and listen for `onCharRejected` then `onComplete` separately.
- **`per-block` / `per-page` and show-mode cells**: show-mode cells fire `onCellComplete` synthetically at create time. Don't filter them out of `onPageComplete` aggregations — they're real entries in the result tree with `mode: "show"` and `complete: true`.
- **Manual `Char.check()`**: only meaningful when `correction: "deferred"` is set on that Char. Otherwise the call no-ops with a logger warning.
