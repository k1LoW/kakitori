import type { BlockResult } from "./block/index.js";
import type { CharResult } from "./charOptions.js";
import type { PageResult } from "./page/index.js";

/** Filter options accepted by {@link collectCharResults}. */
export interface CollectCharResultsOptions {
  /** Keep only results whose `source` is in this list. Default: all sources. */
  sources?: ReadonlyArray<"guided" | "free" | "annotation">;
  /** Keep only results whose `mode` is in this list. Default: both. */
  modes?: ReadonlyArray<"write" | "show">;
  /** When true, keep only entries with `complete: true`. Default: false. */
  completedOnly?: boolean;
}

/**
 * Walk a {@link BlockResult} or {@link PageResult} and return a flat
 * array of every leaf {@link CharResult} matching `options`. Read-only;
 * the input is not mutated. Order = source order (blocks → cells then
 * annotations → chars).
 *
 * Useful for game scoring / practice analytics where the caller wants
 * a flat list of "every character the user touched in this session"
 * rather than walking the nested cells / annotations / blocks tree by
 * hand.
 */
export function collectCharResults(
  result: BlockResult | PageResult,
  options: CollectCharResultsOptions = {},
): CharResult[] {
  const { sources, modes, completedOnly } = options;
  const sourceSet = sources ? new Set(sources) : null;
  const modeSet = modes ? new Set(modes) : null;
  const out: CharResult[] = [];

  function pushIfMatches(c: CharResult): void {
    if (sourceSet && (c.source === undefined || !sourceSet.has(c.source))) {
      return;
    }
    if (modeSet && (c.mode === undefined || !modeSet.has(c.mode))) {
      return;
    }
    if (completedOnly && !c.complete) {
      return;
    }
    out.push(c);
  }

  function walkBlock(b: BlockResult): void {
    for (const cell of b.cells) {
      for (const c of cell.chars) {
        pushIfMatches(c);
      }
    }
    for (const ann of b.annotations) {
      for (const c of ann.chars) {
        pushIfMatches(c);
      }
    }
  }

  // PageResult has `.blocks`, BlockResult has `.cells` + `.annotations`.
  if ("blocks" in result) {
    for (const b of result.blocks) {
      walkBlock(b);
    }
  } else {
    walkBlock(result);
  }
  return out;
}
