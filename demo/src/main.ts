import { Kakitori, defaultCharDataLoader, charSets } from "@k1low/kakitori";
import type { KakitoriStrokeData, CharDataLoaderFn } from "@k1low/kakitori";

// Pre-fetch character data cache
const charDataCache = new Map<string, { strokes: string[]; medians: number[][][] }>();

const cachedCharDataLoader: CharDataLoaderFn = (char, onLoad, onError) => {
  const cached = charDataCache.get(char);
  if (cached) {
    onLoad(cached);
    return;
  }
  defaultCharDataLoader(char, (data) => {
    charDataCache.set(char, data);
    onLoad(data);
  }, onError);
};

// Background pre-fetch all characters
const allChars = Object.values(charSets).flat();
let prefetchIdx = 0;
const PREFETCH_BATCH = 5;

function prefetchBatch() {
  const end = Math.min(prefetchIdx + PREFETCH_BATCH, allChars.length);
  for (let i = prefetchIdx; i < end; i++) {
    const char = allChars[i];
    if (!charDataCache.has(char)) {
      defaultCharDataLoader(char, (data) => {
        charDataCache.set(char, data);
      }, () => {});
    }
  }
  prefetchIdx = end;
  if (prefetchIdx < allChars.length) {
    setTimeout(prefetchBatch, 200);
  }
}

prefetchBatch();

const galleryEl = document.getElementById("gallery")!;
const practiceEl = document.getElementById("practice")!;
const writerEl = document.getElementById("writer")!;
const practiceCharEl = document.getElementById("practice-char")!;
const quizBtn = document.getElementById("quiz-btn")!;
const animateBtn = document.getElementById("animate-btn")!;
const highlightBtn = document.getElementById("highlight-btn")!;
const strokeSlotsEl = document.getElementById("stroke-slots")!;
const summaryEl = document.getElementById("summary")!;
const logEl = document.getElementById("log")!;

let kakitori: Kakitori | null = null;
let strokeSlotEls: HTMLElement[] = [];
let highlightIdx = -1;

const sectionLabels: Record<string, string> = {
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

// Build gallery sections
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
  for (const char of chars) {
    const cell = document.createElement("div");
    cell.className = "char-cell";
    grid.appendChild(cell);

    Kakitori.render(cell, char, {
      size: 60,
      padding: 5,
      charDataLoader: cachedCharDataLoader,
      onClick: ({ character }) => openPractice(character),
    });
  }
}

// Practice

function log(msg: string) {
  const now = performance.now();
  const ms = String(Math.floor(now) % 10000).padStart(4, "0");
  logEl.textContent += `[${ms}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function clearResult() {
  strokeSlotsEl.innerHTML = "";
  summaryEl.textContent = "";
  strokeSlotEls = [];
}

function buildSlots(strokeCount: number, endings: readonly { types?: string[] }[] | null) {
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

function openPractice(char: string) {
  kakitori?.destroy();
  practiceEl.style.display = "block";
  practiceCharEl.textContent = char;

  writerEl.innerHTML = "";
  clearResult();
  logEl.textContent = "";
  highlightIdx = -1;

  let mistakes = 0;
  let strokeEndingMistakes = 0;

  function updateSummary() {
    summaryEl.textContent = `Mistakes: ${mistakes}, Stroke ending mistakes: ${strokeEndingMistakes}`;
  }

  kakitori = Kakitori.create(writerEl, char, {
    size: 300,
    drawingWidth: 12,
    showGrid: true,
    charDataLoader: cachedCharDataLoader,
    logger: log,
    onCorrectStroke: (data: KakitoriStrokeData) => {
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
    onMistake: () => {
      mistakes++;
      updateSummary();
    },
    onStrokeEndingMistake: () => {
      strokeEndingMistakes++;
      updateSummary();
    },
    onComplete: () => {
      updateSummary();
    },
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Open default character
openPractice("あ");

quizBtn.addEventListener("click", async () => {
  if (!kakitori) return;
  await kakitori.ready();

  const endings = kakitori.getStrokeEndings();
  const has = endings && endings.length > 0;
  log(`strokeEndings: ${has ? "yes" : "no"}`);

  const strokeCount = kakitori.getLogicalStrokeCount();
  buildSlots(strokeCount, endings);

  kakitori.resetStrokeColors();
  highlightIdx = -1;
  kakitori.start();
});

animateBtn.addEventListener("click", async () => {
  if (!kakitori) return;
  await kakitori.ready();
  kakitori.resetStrokeColors();
  highlightIdx = -1;
  kakitori.animate();
});

writerEl.addEventListener("click", (e) => {
  if (!kakitori) return;
  const idx = kakitori.getStrokeIndexAtPoint(e.clientX, e.clientY);
  if (idx !== null) {
    kakitori.resetStrokeColors();
    kakitori.setStrokeColor(idx, "#c00");
    highlightIdx = idx;
    log(`click: stroke ${idx + 1} highlighted`);
  }
});

highlightBtn.addEventListener("click", () => {
  if (!kakitori) return;
  const count = kakitori.getLogicalStrokeCount();
  if (count === 0) return;
  kakitori.resetStrokeColors();
  highlightIdx = (highlightIdx + 1) % count;
  kakitori.setStrokeColor(highlightIdx, "#c00");
  log(`highlight: stroke ${highlightIdx + 1}/${count}`);
});
