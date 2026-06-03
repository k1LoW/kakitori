import {
  char,
  defaultCharDataLoader,
  defaultConfigLoader,
  HANZI_Y_MAX,
  HANZI_Y_MIN,
} from "@k1low/kakitori";
import type {
  Char,
  CharacterConfig,
  CharDataLoaderFn,
  ConfigLoaderFn,
  TimedPoint,
} from "@k1low/kakitori";

// Self-contained loader caches so a remount on every slider tick does
// not retrigger an unpkg fetch. char.ts has its own cache; the two
// modules deliberately stay independent so the sizing demo doesn't
// reach into char.ts internals.
//
// Stored as Promises (matching configCache below) so concurrent first-
// time mounts for the same character share a single in-flight fetch
// instead of each kicking off their own. setupSizeDemo mounts three
// "永" cells back-to-back, so without inflight sharing the same
// character would be fetched three times in parallel on first paint.
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
    // Evict on rejection so a transient unpkg failure does not poison
    // every subsequent fetch for the same character with the same
    // rejected promise.
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

const SIZE_DEMO_CHAR = "永";
const SIZE_DEMO_CELLS: ReadonlyArray<{ size: number; id: string }> = [
  { size: 80, id: "sizing-cell-80" },
  { size: 160, id: "sizing-cell-160" },
  { size: 280, id: "sizing-cell-280" },
];

const INSPECTOR_CHAR = "一";
const INSPECTOR_SIZE_DEFAULT = 200;
const DRAWING_WIDTH_DEFAULT = 6;

/**
 * Build a fresh Char instance, pin the wrapper to `size × size` (so it
 * does not collapse visually between teardown and the new mount), and
 * start a free-drawing practice cell with the "paper" feel: no outline,
 * no template character, retained ink.
 *
 * `correction: "per-char"` bypasses hanzi-writer's per-stroke matcher
 * so the user can freely draw without per-stroke rejection;
 * `maxRetries: 0` means the first full attempt commits regardless of
 * OK / NG verdict, so the cell never gets stuck in a retry loop while
 * the user is exploring slider values. Combined with retainStrokes,
 * whatever the user drew stays on screen after the attempt commits.
 *
 * Returns the new Char so the caller can destroy() it before the next
 * remount. Recreating instead of unmount+mount-on-the-same-instance
 * keeps hanzi-writer's quiz lifecycle from sliding into an unwritable
 * half-armed state on repeated remounts.
 */
function createFreeWritingCell(
  character: string,
  target: HTMLElement,
  size: number,
  drawingWidth: number,
  hooks?: {
    onStrokePoints?: (points: ReadonlyArray<TimedPoint>) => void;
  },
): Char {
  target.style.width = `${size}px`;
  target.style.height = `${size}px`;
  const c = char.create(character, {
    charDataLoader: cachedCharDataLoader,
    configLoader: cachedConfigLoader,
  });
  c.mount(target, {
    size,
    drawingWidth,
    retainStrokes: true,
    showAcceptedStroke: false,
    showOutline: false,
    showCharacter: false,
    correction: "per-char",
    maxRetries: 0,
    onCorrectStroke: (data) => hooks?.onStrokePoints?.(data.points),
    onMistake: (data) => hooks?.onStrokePoints?.(data.points),
  });
  // Call start() synchronously right after mount instead of gating on
  // ready(). Char.start() defers its quiz wiring on configReady
  // internally and bails when the instance has been destroyed or
  // unmounted in the meantime, so a fast slider drag that tears the
  // cell down before config resolves cannot land start() on a destroyed
  // instance the way a `ready().then(start)` chain would.
  c.start();
  return c;
}

function formatPointsForInspector(points: ReadonlyArray<TimedPoint>): string {
  if (points.length === 0) {
    return "(empty stroke)";
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) {
      minX = p.x;
    }
    if (p.x > maxX) {
      maxX = p.x;
    }
    if (p.y < minY) {
      minY = p.y;
    }
    if (p.y > maxY) {
      maxY = p.y;
    }
  }
  const fmt = (n: number) => n.toFixed(1).padStart(8);
  const fmtRow = (p: TimedPoint) =>
    `  { x: ${fmt(p.x)}, y: ${fmt(p.y)}, t: ${p.t.toFixed(0).padStart(6)} }`;

  const lines: string[] = [];
  lines.push(`samples: ${points.length}`);
  lines.push(`x range: ${fmt(minX)} .. ${fmt(maxX)}`);
  lines.push(`y range: ${fmt(minY)} .. ${fmt(maxY)}   (region: ${HANZI_Y_MIN} .. ${HANZI_Y_MAX})`);
  lines.push("");
  // Short strokes are printed in full so head + tail windows do not
  // overlap and double up the same sample. Long strokes get the
  // collapsed first 3 / ... / last 3 view.
  if (points.length <= 6) {
    lines.push("samples (all):");
    for (const p of points) {
      lines.push(fmtRow(p));
    }
  } else {
    lines.push("first 3:");
    for (const p of points.slice(0, 3)) {
      lines.push(fmtRow(p));
    }
    lines.push("  ...");
    lines.push("last 3:");
    for (const p of points.slice(-3)) {
      lines.push(fmtRow(p));
    }
  }
  return lines.join("\n");
}

export function setupSizing(root: HTMLElement): void {
  setupSizeDemo(root);
  setupInspectorDemo(root);
}

function setupSizeDemo(root: HTMLElement): void {
  const dwInput = root.querySelector<HTMLInputElement>("#sizing-dw");
  const dwValue = root.querySelector<HTMLOutputElement>("#sizing-dw-value");
  if (!dwInput || !dwValue) {
    return;
  }

  type CellEntry = {
    size: number;
    target: HTMLElement;
    captionDw: HTMLElement | null;
    instance: Char;
  };

  const entries: CellEntry[] = [];

  function rebuild(entry: CellEntry, dw: number): void {
    if (entry.captionDw) {
      entry.captionDw.textContent = String(dw);
    }
    try {
      entry.instance.destroy();
    } catch (err) {
      console.error("[sizing] destroy() failed:", err);
    }
    entry.instance = createFreeWritingCell(
      SIZE_DEMO_CHAR,
      entry.target,
      entry.size,
      dw,
    );
  }

  for (const { size, id } of SIZE_DEMO_CELLS) {
    const target = root.querySelector<HTMLElement>(`#${id}`);
    if (!target) {
      continue;
    }
    const captionDw = root.querySelector<HTMLElement>(
      `[data-dw-for="${size}"]`,
    );
    const instance = createFreeWritingCell(
      SIZE_DEMO_CHAR,
      target,
      size,
      DRAWING_WIDTH_DEFAULT,
    );
    entries.push({ size, target, captionDw, instance });
  }

  // Live value text follows the drag continuously; the writers are only
  // rebuilt on slider release (change). Continuous rebuilds during a
  // drag race hanzi-writer's async quiz setup and can leave cells
  // unwritable.
  dwInput.addEventListener("input", () => {
    dwValue!.value = dwInput.value;
  });
  dwInput.addEventListener("change", () => {
    const next = Number(dwInput.value);
    if (!Number.isFinite(next)) {
      return;
    }
    dwValue!.value = String(next);
    for (const entry of entries) {
      rebuild(entry, next);
    }
  });

  // Per-cell Restart: rebuild that cell with the current drawingWidth
  // (slider value), which also wipes any retained ink.
  root.querySelectorAll<HTMLButtonElement>("[data-sizing-reset]")
    .forEach((btn) => {
      const key = btn.dataset.sizingReset;
      if (!key || key === "inspector") {
        return;
      }
      const sizeNum = Number(key);
      const entry = entries.find((e) => e.size === sizeNum);
      if (!entry) {
        return;
      }
      btn.addEventListener("click", () => {
        const dw = Number(dwInput.value) || DRAWING_WIDTH_DEFAULT;
        rebuild(entry, dw);
      });
    });
}

function setupInspectorDemo(root: HTMLElement): void {
  const sizeInput = root.querySelector<HTMLInputElement>("#sizing-insp-size");
  const sizeValue = root.querySelector<HTMLOutputElement>(
    "#sizing-insp-size-value",
  );
  const writer = root.querySelector<HTMLElement>("#sizing-inspector-writer");
  const out = root.querySelector<HTMLElement>("#sizing-inspector-out");
  const resetBtn = root.querySelector<HTMLButtonElement>(
    '[data-sizing-reset="inspector"]',
  );
  if (!sizeInput || !sizeValue || !writer || !out) {
    return;
  }

  function paintInspector(points: ReadonlyArray<TimedPoint>): void {
    out!.textContent = formatPointsForInspector(points);
  }

  let instance: Char = createFreeWritingCell(
    INSPECTOR_CHAR,
    writer,
    INSPECTOR_SIZE_DEFAULT,
    DRAWING_WIDTH_DEFAULT,
    { onStrokePoints: paintInspector },
  );

  function rebuildAt(size: number): void {
    sizeValue!.value = String(size);
    try {
      instance.destroy();
    } catch (err) {
      console.error("[sizing] destroy() failed:", err);
    }
    instance = createFreeWritingCell(
      INSPECTOR_CHAR,
      writer!,
      size,
      DRAWING_WIDTH_DEFAULT,
      { onStrokePoints: paintInspector },
    );
  }

  // Live value display follows the drag continuously so the user sees
  // the picked size immediately.
  sizeInput.addEventListener("input", () => {
    sizeValue!.value = sizeInput.value;
  });
  // Rebuild only on release (change). Continuous teardown + recreate
  // during a fast drag races hanzi-writer's quiz setup and can leave
  // the cell unwritable.
  sizeInput.addEventListener("change", () => {
    const next = Number(sizeInput.value);
    if (!Number.isFinite(next)) {
      return;
    }
    rebuildAt(next);
  });

  resetBtn?.addEventListener("click", () => {
    out.textContent = "draw a stroke to populate this panel.";
    rebuildAt(Number(sizeInput.value) || INSPECTOR_SIZE_DEFAULT);
  });
}
