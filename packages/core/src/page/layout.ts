import type { BlockSpec, Cell } from "../block/index.js";
import type { PageBlockEntry } from "./types.js";

/**
 * One contiguous run of cells from a single block, placed at a specific
 * grid position. A block with no annotation that doesn't fit in the
 * remainder of a column is split into multiple segments — one per column —
 * so the visual flow is just "cells stacked from the top-right". A block
 * with an annotation never splits: if it doesn't fit it advances to the
 * next column whole, and we'd rather throw than render it half-rendered
 * because the proportional split of furigana characters across segments is
 * almost always wrong (e.g. 大人 → おとな is 0+3 chars, not 1+2 / 2+1).
 */
export interface BlockSegment {
  blockIndex: number;
  /** This segment's position among the block's segments (0-based). */
  segmentIndex: number;
  /** Total segment count for this block. */
  segmentCount: number;
  /** Column index (0-origin, top-right is column 0 in vertical-rl). */
  column: number;
  /** Cell index within the column (0-origin, topmost is 0). */
  cellInColumn: number;
  /** Inclusive cell-range from the original spec that this segment renders. */
  cellFrom: number;
  cellTo: number;
  /** Total cell-slot span this segment occupies (sum across cells in range). */
  span: number;
}

export interface LayoutOptions {
  columns: number;
  cellsPerColumn: number;
}

export interface LayoutResult {
  segments: BlockSegment[];
}

/**
 * Stack `entries` into a `columns × cellsPerColumn` grid, flowing from the
 * top of one column to the next. Annotation-free blocks split at the column
 * boundary; annotation-bearing blocks advance whole to the next column.
 * Throws when a block (or any of its segments) would fall outside the page.
 *
 * Pure (no DOM access) so it's unit-testable without happy-dom.
 */
export function layoutPage(
  entries: ReadonlyArray<PageBlockEntry>,
  opts: LayoutOptions,
): LayoutResult {
  const { columns, cellsPerColumn } = opts;
  if (!Number.isInteger(columns) || columns <= 0) {
    throw new Error(`page.create(): columns must be a positive integer (got ${columns}).`);
  }
  if (!Number.isInteger(cellsPerColumn) || cellsPerColumn <= 0) {
    throw new Error(
      `page.create(): cellsPerColumn must be a positive integer (got ${cellsPerColumn}).`,
    );
  }

  let curColumn = 0;
  let curCell = 0;
  const segments: BlockSegment[] = [];

  for (let i = 0; i < entries.length; i++) {
    const { spec } = entries[i];
    const cellSpans = spec.cells.map((c) => cellSlotSpan(c));
    const totalSpan = cellSpans.reduce((a, b) => a + b, 0);
    if (totalSpan <= 0) {
      throw new Error(`page.create(): blocks[${i}] has 0 slot span (no cells).`);
    }

    // Greedy split at column boundaries. Whether the block has annotations
    // or not, cells flow into the current column, wrap to the next one
    // when the remainder isn't enough for the next cell. The block
    // primitive renders one sub-block per segment, and (for annotations)
    // freeCell.ts handles multi-surface stroke buffering so the user can
    // write the answer naturally across column boundaries.
    let cellIdx = 0;
    const blockSegments: BlockSegment[] = [];
    while (cellIdx < spec.cells.length) {
      if (curColumn >= columns) {
        throw new Error(
          `page.create(): blocks[${i}] would overflow past column=${columns - 1} (only ${columns} column(s) available).`,
        );
      }
      const remainInCol = cellsPerColumn - curCell;
      let takeSpan = 0;
      let takeCells = 0;
      while (cellIdx + takeCells < spec.cells.length) {
        const s = cellSpans[cellIdx + takeCells];
        if (s > cellsPerColumn) {
          throw new Error(
            `page.create(): blocks[${i}].cells[${cellIdx + takeCells}] (${s} slots) exceeds cellsPerColumn=${cellsPerColumn}.`,
          );
        }
        if (takeSpan + s > remainInCol) {
          break;
        }
        takeSpan += s;
        takeCells += 1;
      }
      if (takeCells === 0) {
        // Nothing fits in the current column's remainder — wrap to next.
        curColumn++;
        curCell = 0;
        continue;
      }
      blockSegments.push({
        blockIndex: i,
        segmentIndex: -1, // patched below once we know segmentCount
        segmentCount: -1,
        column: curColumn,
        cellInColumn: curCell,
        cellFrom: cellIdx,
        cellTo: cellIdx + takeCells - 1,
        span: takeSpan,
      });
      cellIdx += takeCells;
      curCell += takeSpan;
      if (curCell >= cellsPerColumn) {
        curColumn++;
        curCell = 0;
      }
    }
    for (let s = 0; s < blockSegments.length; s++) {
      blockSegments[s].segmentIndex = s;
      blockSegments[s].segmentCount = blockSegments.length;
      segments.push(blockSegments[s]);
    }
  }

  return { segments };
}

function cellSlotSpan(cell: Cell): number {
  if (cell.kind === "free") {
    if (cell.span != null) {
      return cell.span;
    }
    const candidates = Array.isArray(cell.expected) ? cell.expected : [cell.expected];
    return Math.max(...candidates.map((c) => Array.from(c).length));
  }
  return 1;
}

/** Total slot span occupied by a block (sum across its cells). */
export function computeBlockSpan(spec: BlockSpec): number {
  return spec.cells.reduce((acc, c) => acc + cellSlotSpan(c), 0);
}
