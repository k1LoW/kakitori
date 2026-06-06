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

export function setupRestoreDemo(root: HTMLElement): void {
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
