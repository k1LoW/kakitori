import {
  char,
  defaultCharDataLoader,
  defaultConfigLoader,
} from "@k1low/kakitori";
import type {
  Char,
  CharacterConfig,
  CharDataLoaderFn,
  CharResult,
  ConfigLoaderFn,
} from "@k1low/kakitori";
import { block, type Block } from "@k1low/kakitori/block";
import type { BlockResult } from "@k1low/kakitori/block";
import { page, type Page } from "@k1low/kakitori/page";
import type { PageResult } from "@k1low/kakitori/page";

// Self-contained loader caches (mirrors sizing.ts) so a Save → preview
// cycle does not retrigger an unpkg fetch for the same character.
const charDataCache = new Map<
  string,
  Promise<{ strokes: string[]; medians: number[][][] }>
>();
const cachedCharDataLoader: CharDataLoaderFn = (ch, onLoad, onError) => {
  let promise = charDataCache.get(ch);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      defaultCharDataLoader(ch, resolve, reject);
    });
    promise.catch(() => {
      charDataCache.delete(ch);
    });
    charDataCache.set(ch, promise);
  }
  promise.then(onLoad, onError);
};

const configCache = new Map<string, Promise<CharacterConfig | null>>();
const cachedConfigLoader: ConfigLoaderFn = (ch) => {
  const cached = configCache.get(ch);
  if (cached) {
    return cached;
  }
  const promise = defaultConfigLoader(ch).catch((err: unknown) => {
    configCache.delete(ch);
    throw err;
  });
  configCache.set(ch, promise);
  return promise;
};

const RESTORE_DEMO_CHAR = "永";
const SOURCE_SIZE = 240;
const DRAWING_WIDTH = 6;
const PREVIEW_SIZES = [80, 160, 240] as const;

/**
 * Build a Char and mount it for free-drawing on the source cell.
 * `onComplete` fires once the user has finished tracing every stroke
 * (per-char correction + maxRetries:0 commits the first attempt
 * regardless of OK/NG), at which point the caller can read
 * `c.result()` and feed it into the restore previews.
 */
function buildSourceChar(
  target: HTMLElement,
  onSettled: (result: CharResult) => void,
): Char {
  target.style.width = `${SOURCE_SIZE}px`;
  target.style.height = `${SOURCE_SIZE}px`;
  const c = char.create(RESTORE_DEMO_CHAR, {
    charDataLoader: cachedCharDataLoader,
    configLoader: cachedConfigLoader,
  });
  c.mount(target, {
    size: SOURCE_SIZE,
    drawingWidth: DRAWING_WIDTH,
    retainStrokes: true,
    showAcceptedStroke: false,
    // Keep the reference outline visible so the user has something to
    // trace. Without it the per-char correction has no anchor and the
    // restored preview ends up as freehand scribbles rather than a
    // recognisable character.
    showOutline: true,
    showCharacter: false,
    correction: "per-char",
    maxRetries: 0,
    onComplete: () => {
      onSettled(c.result());
    },
  });
  c.start();
  return c;
}

function setupCharRestoreDemo(root: HTMLElement): void {
  const sourceWriter = root.querySelector<HTMLElement>("#restore-source-writer");
  const resetBtn = root.querySelector<HTMLButtonElement>(
    "#restore-source-reset-btn",
  );
  if (!sourceWriter || !resetBtn) {
    return;
  }

  const previewTargets = PREVIEW_SIZES.map((s) =>
    root.querySelector<HTMLElement>(`#restore-preview-${s}`),
  );
  if (previewTargets.some((t) => t === null)) {
    return;
  }

  function paintPreviews(result: CharResult): void {
    PREVIEW_SIZES.forEach((size, i) => {
      const target = previewTargets[i];
      if (!target) {
        return;
      }
      target.style.width = `${size}px`;
      target.style.height = `${size}px`;
      char.restore(target, result, {
        size,
        drawingWidth: DRAWING_WIDTH,
        showGrid: true,
        charDataLoader: cachedCharDataLoader,
      });
    });
  }

  let source: Char = buildSourceChar(sourceWriter, paintPreviews);

  resetBtn.addEventListener("click", () => {
    try {
      source.destroy();
    } catch (err) {
      console.error("[restore] destroy() failed:", err);
    }
    // Clear preview cells too so Restart truly starts from scratch.
    previewTargets.forEach((t) => {
      if (t) {
        t.replaceChildren();
      }
    });
    source = buildSourceChar(sourceWriter, paintPreviews);
  });
}

const BLOCK_DEMO_CELL_SIZE = 120;
const BLOCK_DEMO_PREVIEW_SIZES = [60, 100] as const;
const BLOCK_DEMO_CHARS = ["山", "川"] as const;
const BLOCK_DEMO_FURIGANA = "やまかわ";

function buildSourceBlock(
  target: HTMLElement,
  onSettled: (result: BlockResult) => void,
): Block {
  return block.create(target, {
    spec: {
      cells: BLOCK_DEMO_CHARS.map((ch) => ({
        kind: "guided" as const,
        char: ch,
        mode: "write" as const,
        overrides: {
          // Same "trace the outline + commit on first attempt" UX as
          // the char demo above: per-char correction means no
          // per-stroke rejection, maxRetries:0 commits the first
          // attempt regardless of OK/NG, showOutline gives a trace
          // hint, retainStrokes keeps the user's ink visible after
          // commit.
          showOutline: true,
          showCharacter: false,
        },
      })),
      annotations: [
        {
          cellRange: [0, BLOCK_DEMO_CHARS.length - 1],
          expected: BLOCK_DEMO_FURIGANA,
          mode: "write",
        },
      ],
    },
    cellSize: BLOCK_DEMO_CELL_SIZE,
    correction: "per-char",
    maxRetries: 0,
    retainStrokes: true,
    showAcceptedStroke: false,
    drawingWidth: DRAWING_WIDTH,
    loaders: {
      charDataLoader: cachedCharDataLoader,
      configLoader: cachedConfigLoader,
    },
    onBlockComplete: (result) => onSettled(result),
  });
}

function setupBlockRestoreDemo(root: HTMLElement): void {
  const sourceEl = root.querySelector<HTMLElement>("#restore-block-source");
  const resetBtn = root.querySelector<HTMLButtonElement>(
    "#restore-block-reset-btn",
  );
  if (!sourceEl || !resetBtn) {
    return;
  }
  const previewTargets = BLOCK_DEMO_PREVIEW_SIZES.map((size) =>
    root.querySelector<HTMLElement>(`#restore-block-preview-${size}`),
  );
  if (previewTargets.some((t) => t === null)) {
    return;
  }

  function paintPreviews(result: BlockResult): void {
    BLOCK_DEMO_PREVIEW_SIZES.forEach((cellSize, i) => {
      const target = previewTargets[i];
      if (!target) {
        return;
      }
      block.restore(target, result, {
        cellSize,
        drawingWidth: DRAWING_WIDTH,
        showOutline: true,
        charDataLoader: cachedCharDataLoader,
      });
    });
  }

  let source: Block = buildSourceBlock(sourceEl, paintPreviews);

  resetBtn.addEventListener("click", () => {
    try {
      source.destroy();
    } catch (err) {
      console.error("[restore] block destroy() failed:", err);
    }
    previewTargets.forEach((t) => {
      if (t) {
        t.replaceChildren();
      }
    });
    source = buildSourceBlock(sourceEl, paintPreviews);
  });
}

const PAGE_DEMO_CELL_SIZE = 120;
const PAGE_DEMO_PREVIEW_CELL_SIZE = 100;
const PAGE_DEMO_BLOCKS: ReadonlyArray<{
  id: string;
  chars: ReadonlyArray<string>;
  furigana?: string;
}> = [
  { id: "block-1", chars: ["山", "川"], furigana: "やまかわ" },
  { id: "block-2", chars: ["大", "小"] },
  { id: "block-3", chars: ["天", "地", "人"] },
];
// 3 blocks of 2 + 2 + 3 slots overflow each column at cellsPerColumn=3,
// so block 2 lands in column 1 and block 3 in column 2 — the layout
// flow that page.restore needs to reproduce faithfully.
const PAGE_DEMO_COLUMNS = 3;
const PAGE_DEMO_CELLS_PER_COLUMN = 3;

function buildSourcePage(
  target: HTMLElement,
  onSettled: (result: PageResult) => void,
): Page {
  return page.create(target, {
    columns: PAGE_DEMO_COLUMNS,
    cellsPerColumn: PAGE_DEMO_CELLS_PER_COLUMN,
    cellSize: PAGE_DEMO_CELL_SIZE,
    correction: "per-char",
    maxRetries: 0,
    retainStrokes: true,
    showAcceptedStroke: false,
    drawingWidth: DRAWING_WIDTH,
    loaders: {
      charDataLoader: cachedCharDataLoader,
      configLoader: cachedConfigLoader,
    },
    blocks: PAGE_DEMO_BLOCKS.map(({ id, chars, furigana }) => ({
      id,
      spec: {
        cells: chars.map((ch) => ({
          kind: "guided" as const,
          char: ch,
          mode: "write" as const,
          overrides: {
            showOutline: true,
            showCharacter: false,
          },
        })),
        ...(furigana
          ? {
              annotations: [
                {
                  cellRange: [0, chars.length - 1] as [number, number],
                  expected: furigana,
                  mode: "write" as const,
                },
              ],
            }
          : {}),
      },
    })),
    onPageComplete: (result) => onSettled(result),
  });
}

function setupPageRestoreDemo(root: HTMLElement): void {
  const sourceEl = root.querySelector<HTMLElement>("#restore-page-source");
  const previewEl = root.querySelector<HTMLElement>("#restore-page-preview");
  const resetBtn = root.querySelector<HTMLButtonElement>(
    "#restore-page-reset-btn",
  );
  if (!sourceEl || !previewEl || !resetBtn) {
    return;
  }

  function paintPreview(result: PageResult): void {
    page.restore(previewEl!, result, {
      columns: PAGE_DEMO_COLUMNS,
      cellsPerColumn: PAGE_DEMO_CELLS_PER_COLUMN,
      cellSize: PAGE_DEMO_PREVIEW_CELL_SIZE,
      drawingWidth: DRAWING_WIDTH,
      showOutline: true,
      charDataLoader: cachedCharDataLoader,
    });
  }

  let source: Page = buildSourcePage(sourceEl, paintPreview);

  resetBtn.addEventListener("click", () => {
    try {
      source.destroy();
    } catch (err) {
      console.error("[restore] page destroy() failed:", err);
    }
    previewEl.replaceChildren();
    source = buildSourcePage(sourceEl, paintPreview);
  });
}

export function setupRestoreDemo(root: HTMLElement): void {
  setupCharRestoreDemo(root);
  setupBlockRestoreDemo(root);
  setupPageRestoreDemo(root);
}
