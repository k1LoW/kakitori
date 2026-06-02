import {
  char,
  defaultCharDataLoader,
  defaultConfigLoader,
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
const charDataCache = new Map<
  string,
  { strokes: string[]; medians: number[][][] }
>();
const cachedCharDataLoader: CharDataLoaderFn = (ch, onLoad, onError) => {
  const cached = charDataCache.get(ch);
  if (cached) {
    onLoad(cached);
    return;
  }
  defaultCharDataLoader(
    ch,
    (data) => {
      charDataCache.set(ch, data);
      onLoad(data);
    },
    onError,
  );
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
 * Mount one practice cell with the "paper" feel: no outline, no
 * template character, retained ink. correction: "per-char" + maxRetries: 0
 * means the cell accepts any freely-drawn input and commits on the first
 * attempt, so the user can switch slider values and restart freely
 * without ever getting stuck in a retry loop.
 */
function mountFreeWritingCell(
  c: Char,
  target: HTMLElement,
  size: number,
  drawingWidth: number,
  hooks?: {
    onStrokePoints?: (points: ReadonlyArray<TimedPoint>) => void;
  },
): void {
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
  void c.ready().then(
    () => c.start(),
    (err: unknown) => console.error("[sizing] ready() failed:", err),
  );
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
  const head = points.slice(0, 3);
  const tail = points.slice(-3);
  const fmtRow = (p: TimedPoint) =>
    `  { x: ${fmt(p.x)}, y: ${fmt(p.y)}, t: ${p.t.toFixed(0).padStart(6)} }`;

  const lines: string[] = [];
  lines.push(`samples: ${points.length}`);
  lines.push(`x range: ${fmt(minX)} .. ${fmt(maxX)}`);
  lines.push(`y range: ${fmt(minY)} .. ${fmt(maxY)}   (region: -124 .. 900)`);
  lines.push("");
  lines.push("first 3:");
  for (const p of head) {
    lines.push(fmtRow(p));
  }
  if (points.length > 6) {
    lines.push("  ...");
    lines.push("last 3:");
    for (const p of tail) {
      lines.push(fmtRow(p));
    }
  } else if (points.length > 3) {
    lines.push("last:");
    for (const p of tail) {
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

  for (const { size, id } of SIZE_DEMO_CELLS) {
    const target = root.querySelector<HTMLElement>(`#${id}`);
    if (!target) {
      continue;
    }
    const captionDw = root.querySelector<HTMLElement>(
      `[data-dw-for="${size}"]`,
    );
    const c = char.create(SIZE_DEMO_CHAR, {
      charDataLoader: cachedCharDataLoader,
      configLoader: cachedConfigLoader,
    });
    mountFreeWritingCell(c, target, size, DRAWING_WIDTH_DEFAULT);
    entries.push({ size, target, captionDw, instance: c });
  }

  function applyDrawingWidth(dw: number): void {
    dwValue!.value = String(dw);
    for (const entry of entries) {
      if (entry.captionDw) {
        entry.captionDw.textContent = String(dw);
      }
      // The runtime API has no setDrawingWidth; remounting is the
      // straightforward way to apply the new pen thickness. The
      // existing instance is reused so config / strokeGroups are not
      // re-fetched.
      entry.instance.unmount();
      mountFreeWritingCell(entry.instance, entry.target, entry.size, dw);
    }
  }

  dwInput.addEventListener("input", () => {
    const next = Number(dwInput.value);
    if (!Number.isFinite(next)) {
      return;
    }
    applyDrawingWidth(next);
  });

  // Per-cell Restart: unmount + remount with the current drawingWidth
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
        entry.instance.unmount();
        mountFreeWritingCell(entry.instance, entry.target, entry.size, dw);
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

  const instance = char.create(INSPECTOR_CHAR, {
    charDataLoader: cachedCharDataLoader,
    configLoader: cachedConfigLoader,
  });

  function paintInspector(points: ReadonlyArray<TimedPoint>): void {
    out!.textContent = formatPointsForInspector(points);
  }

  function remountAt(size: number): void {
    sizeValue!.value = String(size);
    instance.unmount();
    mountFreeWritingCell(instance, writer!, size, DRAWING_WIDTH_DEFAULT, {
      onStrokePoints: paintInspector,
    });
  }

  remountAt(INSPECTOR_SIZE_DEFAULT);

  sizeInput.addEventListener("input", () => {
    const next = Number(sizeInput.value);
    if (!Number.isFinite(next)) {
      return;
    }
    remountAt(next);
  });

  resetBtn?.addEventListener("click", () => {
    out.textContent = "draw a stroke to populate this panel.";
    remountAt(Number(sizeInput.value) || INSPECTOR_SIZE_DEFAULT);
  });
}
