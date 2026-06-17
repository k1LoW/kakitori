# Stroke matcher (leniency + tome / hane / harai)

kakitori's matcher = hanzi-writer's matcher + a tome / hane / harai layer on top.

## leniency in one paragraph

`leniency` is a multiplier on hanzi-writer's tolerance, default `1.0`. Higher = more permissive, lower = stricter. It scales 4 of the 5 AND-gated stroke checks (average distance, start / end position, Fréchet shape, length ratio); the direction (cosine similarity) check is fixed and not affected by leniency.

`0` / negatives / `NaN` / `Infinity` are rejected at every kakitori entry point because they silently break the matcher inside hanzi-writer (the threshold becomes 0 or undefined and either everything passes or nothing does).

## The 5 AND checks

A user stroke is accepted iff every one of these is true.

```
avgDist           <= 350 * distMod * leniency      # distMod = 1 (first stroke, outline hidden) else 0.5
startingDist      <= 250 * leniency
endingDist        <= 250 * leniency
avgCosineSim      >  0                              # NOT scaled by leniency
frechetDist       <= 0.4 * leniency                 # min over 5 small rotations of the median
leniency * (len(user) + 25) / (len(median) + 25)  >= 0.35
```

Distances are in hanzi-writer's internal 1024 coordinate system (the character region is 1024 wide × 1024 tall, Y-up, baseline at y=0). Both the median and the user's drawn points get projected into this space before comparison, so judgment is **independent of display `size`**.

Source pointers (hanzi-writer 3.7.3, `dist/index.esm.js`):
- `getAverageDistance` (L536)
- `COSINE_SIMILARITY_THRESHOLD = 0` (L622)
- `START_AND_END_DIST_THRESHOLD = 250` (L624)
- `FRECHET_THRESHOLD = 0.4` (L626)
- `MIN_LEN_THRESHOLD = 0.35` (L628)
- `getMatchData` (L758) — the actual AND gate
- `strokeMatches` (L630) — entry point + backward detection + later-stroke conflict resolution

## What each check actually catches

| Check | Catches | leniency effect |
|---|---|---|
| Average distance | Globally shifted strokes | scales the tolerance |
| Start / end position | Wrong starting / ending point (even if shape matches) | scales the tolerance |
| Direction (cosine) | Reverse-direction strokes | none |
| Fréchet shape | Local shape deviation (not just average) | scales the tolerance |
| Length ratio | Strokes that are way too short / long | scales the tolerance |

If the user complains "I write the right shape but in the wrong position and it passes" → lower `leniency` (tightens average + start / end + Fréchet at the same rate; length is also tightened but a correct-shape stroke usually passes length easily).

If the user complains "I write the right shape but the wrong direction and it still passes" → leniency cannot fix this; the cosine check is fixed at 0. But hanzi-writer does a backward-stroke detection pass — see below.

## Backward (reverse-direction) detection

When `getMatchData` returns `isMatch: false`, the matcher reverses the user's points and tries again. If the reversed form would match, `isMatch` stays `false` but `meta.isStrokeBackwards: true` is reported, and `onCorrectStroke` / `onMistake` callbacks can see `data.isBackwards`.

`MountOptions.acceptBackwardsStrokes: true` (forwarded to hanzi-writer) promotes backward matches to accepted; off by default. Set it explicitly if you want to be lenient about direction.

## Later-stroke conflict resolution

After the current stroke passes the AND gate, the matcher scans every later stroke of the character. If any later stroke has a lower `avgDist` against the user's drawn stroke than the current stroke did, the matcher concludes "the user probably skipped to a later stroke" and retries the current stroke with a tightened effective leniency:

```
leniencyAdjustment = 0.6 * (closestMatchDist + avgDist) / (2 * avgDist)
                   ∈ [0.3, 0.6]
effectiveLeniency  = options.leniency * leniencyAdjustment
```

This means setting `leniency: 3.0` does NOT bypass conflict resolution — the implicit tightening still triggers when later strokes are a better fit. It's an automatic safeguard against the matcher silently swallowing wrong-stroke attempts.

## Distance threshold base value

`averageDistanceThreshold: 350` is the underlying constant. hanzi-writer exposes it as a separate option, but kakitori does NOT currently forward it through `char.create` / `block.create` / `page.create`. The only matcher knob kakitori currently exposes is `leniency`.

If you find yourself wanting to tighten only the average-distance check without affecting Fréchet / start-end / length, that capability does not exist in the current kakitori surface; the leniency knob ties all four together.

## tome / hane / harai (stroke endings)

Layered on top of hanzi-writer's match. kakitori looks at the last few points of each accepted stroke and classifies the ending as `tome` (stop), `hane` (hook), or `harai` (sweep). Strictness is controlled by `CharCreateOptions.strokeEndingStrictness` in `[0, 1]`, default `0.7`.

- Higher value = stricter judgment (the ending shape has to be more pronounced).
- Lower value = looser (close-to-flat tails still get classified).

Output lands in `CharStrokeData.strokeEnding` (the callback payload) and `CharStrokeResult.strokeEnding` (in the result tree):

```ts
interface StrokeEndingResult {
  expected: ("tome" | "hane" | "harai")[];   // what the data set says is acceptable
  observed: "tome" | "hane" | "harai" | null;
  correct: boolean;
}
```

`expected` is a list because a stroke can legitimately end multiple ways (e.g. a horizontal that's acceptable as either tome or hane in different writing styles). `correct = true` iff `observed ∈ expected`.

By default, an ending mismatch does NOT reject the stroke — only `onStrokeEndingMistake` fires alongside `onCorrectStroke`. To make it a full miss (rejecting the stroke and asking the user to redraw), set `MountOptions.strokeEndingAsMiss: true`.

## Similarity score

`CharStrokeResult.similarity` is in `[0, 1]`, derived as:

```
similarity = max(0, min(1, 1 - avgDist / (HW_AVERAGE_DISTANCE_THRESHOLD * leniency)))
HW_AVERAGE_DISTANCE_THRESHOLD = 350     # kakitori mirrors this constant
```

It's a convenience number — kakitori computes it without re-running the matcher. `1.0` means "the user's points were on top of the median"; `0.0` means "average distance exceeded the threshold". Use it to rank attempts or color-code strokes by quality; do not use it to re-implement the match decision (the actual decision uses all 5 AND checks).

## Debugging stroke judgment

When a user reports "this stroke should pass but doesn't" or vice versa:

1. Capture the rejected stroke's `points` from `onMistake`'s callback payload (or read `result().perStroke[i].points`).
2. Check the start / end deviation against the median. The matcher's start / end threshold (`250 * leniency`) is in 1024-coord units; 250 is ~24% of the character box. If the user starts the stroke far from the median's start, that check fails before any shape evaluation.
3. Check direction. If `data.isBackwards === true` you wrote it the right shape but the wrong direction; consider `acceptBackwardsStrokes: true`.
4. Cross-reference `similarity`. If similarity is very low (< 0.2), the average distance is far over threshold and leniency would have to be > 2 to compensate.
5. As a last resort, the `logger` option (`CharCreateOptions.logger`) emits verbose matcher trace. Enable it temporarily to see hanzi-writer's per-stroke decisions.

## Default values cheat sheet

| Option | Default | Where |
|---|---|---|
| `leniency` | `1.0` | hanzi-writer default, kakitori forwards as-is |
| `freeCellLeniency` | `1.0` (de-facto) | separate threshold for free / annotation cells |
| `strokeEndingStrictness` | `0.7` | kakitori-side |
| `acceptBackwardsStrokes` | `false` | hanzi-writer default |
| `strokeEndingAsMiss` | `false` | kakitori-side; when true, an ending NG rejects the stroke entirely |
| `showHintAfterMisses` | `3` | hanzi-writer default; show the next stroke after N misses |
| `markStrokeCorrectAfterMisses` | `false` | hanzi-writer default; auto-accept after N misses |
