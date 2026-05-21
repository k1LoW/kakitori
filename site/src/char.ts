import {
  char,
  defaultCharDataLoader,
  defaultConfigLoader,
  charSets,
} from "@k1low/kakitori";
import type {
  CharacterConfig,
  Char,
  CharStrokeData,
  CharDataLoaderFn,
  ConfigLoaderFn,
} from "@k1low/kakitori";

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

// Mirror `cachedCharDataLoader` for the config JSON so multiple Char
// instances on the same character (e.g. the five examples, all on
// "学") share a single unpkg fetch instead of issuing N redundant
// network requests at setup time.
const configCache = new Map<string, Promise<CharacterConfig | null>>();

const cachedConfigLoader: ConfigLoaderFn = (ch) => {
  const cached = configCache.get(ch);
  if (cached) {
    return cached;
  }
  const promise = defaultConfigLoader(ch);
  configCache.set(ch, promise);
  return promise;
};

const allChars = Object.values(charSets).flat();
let prefetchIdx = 0;
const PREFETCH_BATCH = 5;

function prefetchBatch() {
  const end = Math.min(prefetchIdx + PREFETCH_BATCH, allChars.length);
  for (let i = prefetchIdx; i < end; i++) {
    const ch = allChars[i];
    if (!charDataCache.has(ch)) {
      defaultCharDataLoader(
        ch,
        (data) => {
          charDataCache.set(ch, data);
        },
        () => {},
      );
    }
  }
  prefetchIdx = end;
  if (prefetchIdx < allChars.length) {
    setTimeout(prefetchBatch, 200);
  }
}

const sectionLabels: Record<string, string> = {
  number: "数字",
  hiragana: "ひらがな",
  katakana: "カタカナ",
  grade1: "小学1年",
  grade2: "小学2年",
  grade3: "小学3年",
  grade4: "小学4年",
  grade5: "小学5年",
  grade6: "小学6年",
  juniorHigh: "中学校",
};

export function setupChar(root: HTMLElement): void {
  prefetchBatch();

  const galleryEl = root.querySelector<HTMLElement>("#char-gallery")!;
  const writerEl = root.querySelector<HTMLElement>("#char-writer")!;
  const practiceCharEl = root.querySelector<HTMLElement>("#char-practice-char")!;
  const quizBtn = root.querySelector<HTMLElement>("#char-quiz-btn")!;
  const animateBtn = root.querySelector<HTMLElement>("#char-animate-btn")!;
  const highlightBtn = root.querySelector<HTMLElement>("#char-highlight-btn")!;
  const resetBtn = root.querySelector<HTMLElement>("#char-reset-btn")!;
  const strokeSlotsEl = root.querySelector<HTMLElement>("#char-stroke-slots")!;
  const summaryEl = root.querySelector<HTMLElement>("#char-summary")!;
  const logEl = root.querySelector<HTMLElement>("#char-log")!;

  let c: Char | null = null;
  let strokeSlotEls: HTMLElement[] = [];
  let highlightIdx = -1;

  for (const [key, chars] of Object.entries(charSets)) {
    const label = sectionLabels[key] ?? key;

    const header = document.createElement("div");
    header.className = "section-header";
    header.textContent = `${label} (${chars.length})`;

    const grid = document.createElement("div");
    grid.className = "char-grid";
    grid.style.display = "none";

    let rendered = false;

    header.addEventListener("click", () => {
      const isOpen = header.classList.toggle("open");
      grid.style.display = isOpen ? "flex" : "none";

      if (isOpen && !rendered) {
        rendered = true;
        renderSection(grid, chars);
      }
    });

    galleryEl.appendChild(header);
    galleryEl.appendChild(grid);
  }

  function renderSection(grid: HTMLElement, chars: string[]) {
    for (const ch of chars) {
      const cell = document.createElement("div");
      cell.className = "char-cell";
      grid.appendChild(cell);

      char.render(cell, ch, {
        size: 60,
        padding: 5,
        charDataLoader: cachedCharDataLoader,
        onClick: ({ character }) => openPractice(character),
      });
    }
  }

  function log(msg: string) {
    const now = performance.now();
    const ms = String(Math.floor(now) % 10000).padStart(4, "0");
    logEl.textContent += `[${ms}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function formatStrokeData(data: CharStrokeData): string {
    const { points, ...rest } = data;
    return JSON.stringify({ ...rest, points: points.length });
  }

  function clearResult() {
    strokeSlotsEl.innerHTML = "";
    summaryEl.textContent = "";
    strokeSlotEls = [];
  }

  function buildSlots(
    strokeCount: number,
    endings: readonly { types?: string[] }[] | null,
  ) {
    clearResult();
    for (let i = 0; i < strokeCount; i++) {
      const slot = document.createElement("span");
      slot.className = "stroke-slot";
      const endingLabel = endings?.[i]?.types?.length
        ? endings[i].types!.join("/")
        : "-";
      slot.textContent = `${i + 1}: ${endingLabel}`;
      strokeSlotsEl.appendChild(slot);
      strokeSlotEls.push(slot);
    }
    summaryEl.textContent = "Mistakes: 0, Stroke ending mistakes: 0";
  }

  let currentCharacter = "あ";

  function openPractice(character: string) {
    currentCharacter = character;
    c?.destroy();
    practiceCharEl.textContent = character;

    writerEl.innerHTML = "";
    clearResult();
    logEl.textContent = "";
    highlightIdx = -1;

    let mistakes = 0;
    let strokeEndingMistakes = 0;

    function updateSummary() {
      summaryEl.textContent = `Mistakes: ${mistakes}, Stroke ending mistakes: ${strokeEndingMistakes}`;
    }

    c = char.create(character, {
      charDataLoader: cachedCharDataLoader,
      configLoader: cachedConfigLoader,
      logger: log,
    });
    c.mount(writerEl, {
      size: 300,
      drawingWidth: 6,
      onClick: ({ strokeIndex }) => {
        // Click-to-inspect: highlight the clicked stroke red. Core
        // already gates this callback so it never fires while a quiz
        // / per-char cycle is active, so a trailing drag-tail click
        // can't recolor a just-accepted stroke.
        if (strokeIndex === null || !c) {
          return;
        }
        c.resetStrokeColors();
        c.setStrokeColor(strokeIndex, "#c00");
        highlightIdx = strokeIndex;
        log(`click: stroke ${strokeIndex + 1} highlighted`);
      },
      onCorrectStroke: (data: CharStrokeData) => {
        log(`onCorrectStroke ${formatStrokeData(data)}`);
        const slot = strokeSlotEls[data.strokeNum];
        if (slot && data.strokeEnding) {
          const ok = data.strokeEnding.correct;
          slot.className = `stroke-slot ${ok ? "ok" : "ng"}`;
          const label = data.strokeEnding.expected;
          slot.textContent = `${data.strokeNum + 1}: ${label} ${ok ? "OK" : "NG"}`;
        } else if (slot) {
          slot.className = "stroke-slot ok";
        }
      },
      onMistake: (data: CharStrokeData) => {
        log(`onMistake ${formatStrokeData(data)}`);
        mistakes++;
        updateSummary();
      },
      onStrokeEndingMistake: (data: CharStrokeData) => {
        log(`onStrokeEndingMistake ${formatStrokeData(data)}`);
        strokeEndingMistakes++;
        updateSummary();
      },
      onComplete: (data: {
        character: string;
        totalMistakes: number;
        strokeEndingMistakes: number;
      }) => {
        log(`onComplete ${JSON.stringify(data)}`);
        updateSummary();
      },
    });
  }

  openPractice(currentCharacter);

  quizBtn.addEventListener("click", async () => {
    if (!c) {
      return;
    }
    await c.ready();

    const endings = c.getStrokeEndings();
    const has = endings && endings.length > 0;
    log(`strokeEndings: ${has ? "yes" : "no"}`);

    const strokeCount = c.getLogicalStrokeCount();
    buildSlots(strokeCount, endings);

    c.resetStrokeColors();
    highlightIdx = -1;
    c.start();
  });

  animateBtn.addEventListener("click", async () => {
    if (!c) {
      return;
    }
    await c.ready();
    clearResult();
    c.resetStrokeColors();
    highlightIdx = -1;
    c.animate();
  });

  // Click-to-inspect is now wired through mount's `onClick` option
  // (set in openPractice) — core gates the callback on quizActive so
  // a trailing drag-tail click during drawing cannot recolor a
  // just-accepted stroke.

  highlightBtn.addEventListener("click", () => {
    if (!c) {
      return;
    }
    const count = c.getLogicalStrokeCount();
    if (count === 0) {
      return;
    }
    c.resetStrokeColors();
    highlightIdx = (highlightIdx + 1) % count;
    c.setStrokeColor(highlightIdx, "#c00");
    log(`highlight: stroke ${highlightIdx + 1}/${count}`);
  });

  resetBtn.addEventListener("click", () => {
    if (!c) {
      return;
    }
    c.reset();
    highlightIdx = -1;
    clearResult();
    log("reset");
  });

  setupCharExamples(root);
}

type ExampleKey =
  | "normal"
  | "no-grid"
  | "no-outline"
  | "per-char"
  | "retain";

interface ExampleConfig {
  key: ExampleKey;
  mountOpts: Parameters<Char["mount"]>[1];
}

const EXAMPLE_CHARACTER = "学";
const EXAMPLE_SIZE = 160;

const EXAMPLES: ExampleConfig[] = [
  {
    key: "normal",
    mountOpts: { size: EXAMPLE_SIZE },
  },
  {
    key: "no-grid",
    mountOpts: { size: EXAMPLE_SIZE, showGrid: false },
  },
  {
    key: "no-outline",
    mountOpts: { size: EXAMPLE_SIZE, showOutline: false },
  },
  {
    key: "per-char",
    mountOpts: {
      size: EXAMPLE_SIZE,
      correction: "per-char",
    },
  },
  {
    key: "retain",
    mountOpts: {
      size: EXAMPLE_SIZE,
      retainStrokes: true,
      showAcceptedStroke: false,
    },
  },
];

function setupCharExamples(root: HTMLElement): void {
  const resetters = new Map<ExampleKey, () => void>();

  for (const { key, mountOpts } of EXAMPLES) {
    const target = root.querySelector<HTMLElement>(`#char-example-${key}`);
    if (!target) {
      continue;
    }
    const statusEl = root.querySelector<HTMLElement>(
      `[data-status-for="${key}"]`,
    );

    let chips: HTMLElement[] = [];
    function renderChips(strokeCount: number) {
      if (!statusEl) {
        return;
      }
      statusEl.replaceChildren();
      chips = [];
      for (let i = 0; i < strokeCount; i++) {
        const chip = document.createElement("span");
        chip.className = "char-example-chip";
        chip.textContent = String(i + 1);
        statusEl.appendChild(chip);
        chips.push(chip);
      }
    }
    function clearChips() {
      for (const chip of chips) {
        chip.classList.remove("ok", "ng");
      }
    }
    function markChip(strokeNum: number, kind: "ok" | "ng") {
      const chip = chips[strokeNum];
      if (!chip) {
        return;
      }
      chip.classList.remove("ok", "ng");
      chip.classList.add(kind);
    }

    const c = char.create(EXAMPLE_CHARACTER, {
      charDataLoader: cachedCharDataLoader,
      configLoader: cachedConfigLoader,
    });
    c.mount(target, {
      ...mountOpts,
      onCorrectStroke: (data) => markChip(data.strokeNum, "ok"),
      onMistake: (data) => markChip(data.strokeNum, "ng"),
      onCharRejected: clearChips,
    });
    // The code samples shipped with each example end in `c.start()`,
    // so kick the writer off automatically to match — the only
    // exposed control is Restart, which re-arms from scratch
    // (`c.reset()` + `c.start()`). Wait on `ready()` so hanzi-writer's
    // config has landed before the quiz arms; character data is
    // fetched separately and may still be pending, so the chip-row
    // render polls `getLogicalStrokeCount()` until it materializes.
    // Without that, start() races against the initial render and
    // leaves the cell showing the static character template instead
    // of quiz mode, AND the chip row paints 0 chips against a
    // not-yet-parsed character.
    const readyPromise = c.ready().catch((err: unknown) => {
      console.error(`[char-example ${key}] ready() failed:`, err);
    });
    function startAndRenderChips() {
      const tryRender = (remaining: number) => {
        const count = c.getLogicalStrokeCount();
        if (count > 0) {
          renderChips(count);
          return;
        }
        if (remaining > 0) {
          setTimeout(() => tryRender(remaining - 1), 30);
        }
      };
      tryRender(20);
      c.start();
    }
    void readyPromise.then(startAndRenderChips);
    // Restart shares the same `readyPromise` so clicking before the
    // initial load finishes simply enqueues another reset/start
    // behind the same gate rather than racing the in-flight init.
    resetters.set(key, () => {
      void readyPromise.then(() => {
        clearChips();
        c.reset();
        startAndRenderChips();
      });
    });
  }

  root.querySelectorAll<HTMLButtonElement>("[data-example]").forEach((btn) => {
    const key = btn.dataset.example as ExampleKey | undefined;
    if (!key || btn.dataset.action !== "reset") {
      return;
    }
    btn.addEventListener("click", () => {
      // Reset clears the canvas + chip state; re-start so the user
      // can immediately write again without having to hunt for a
      // separate Start.
      resetters.get(key)?.();
    });
  });
}
