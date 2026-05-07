import { defaultCharDataLoader } from "@k1low/kakitori";
import type { CharDataLoaderFn } from "@k1low/kakitori";
import { page, type Page, type PageBlockEntry } from "@k1low/kakitori/page";

const charDataCache = new Map<string, { strokes: string[]; medians: number[][][] }>();

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

const hostEl = document.getElementById("page-host")!;
const logEl = document.getElementById("log")!;
const statusEl = document.getElementById("status")!;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;

let currentPage: Page | null = null;

function log(msg: string, kind: "info" | "ok" | "ng" = "info") {
  const line = document.createElement("div");
  if (kind !== "info") {
    line.className = kind;
  }
  const t = String(Math.floor(performance.now()) % 100000).padStart(5, "0");
  line.textContent = `[${t}] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.replaceChildren();
}

// 5 columns × 8 cellsPerColumn (vertical-rl). Blocks flow from top of
// column 0 (rightmost) to the next column. Annotation-bearing and free
// blocks both split across column boundaries; annotation strokes share a
// buffer across surfaces, so the user can write the answer freely.
function blocks(): PageBlockEntry[] {
  return [
    // 学校 + ふりがな (cells 0-1 / col 0)
    {
      id: "q1",
      spec: {
        cells: [
          { kind: "guided", char: "学", mode: "write" },
          { kind: "guided", char: "校", mode: "write" },
        ],
        annotations: [
          { cellRange: [0, 1], expected: "がっこう", mode: "show" },
        ],
      },
    },
    // 先生 + ふりがな (cells 2-3 / col 0)
    {
      id: "q2",
      spec: {
        cells: [
          { kind: "guided", char: "先", mode: "write" },
          { kind: "guided", char: "生", mode: "write" },
        ],
        annotations: [
          { cellRange: [0, 1], expected: "せんせい", mode: "show" },
        ],
      },
    },
    // 天気 (穴あき) + ふりがな (cells 4-5 / col 0)
    {
      id: "q3",
      spec: {
        cells: [
          { kind: "guided", char: "天", mode: "write" },
          { kind: "guided", char: "気", mode: "show" },
        ],
        annotations: [
          { cellRange: [0, 1], expected: "てんき", mode: "show" },
        ],
      },
    },
    // 山 川 (cells 6, 7 / col 0)
    { id: "q4", spec: { cells: [{ kind: "guided", char: "山", mode: "write" }] } },
    { id: "q5", spec: { cells: [{ kind: "guided", char: "川", mode: "write" }] } },
    // free がっこう (col 1 cells 0-3)
    {
      id: "q6",
      spec: { cells: [{ kind: "free", expected: "がっこう", mode: "write", span: 4 }] },
    },
    // 大人 + おとな ★不均一読み (3 chars over 2 cells)
    // col 1 cells 4-5
    {
      id: "q7",
      spec: {
        cells: [
          { kind: "guided", char: "大", mode: "write" },
          { kind: "guided", char: "人", mode: "write" },
        ],
        annotations: [
          { cellRange: [0, 1], expected: "おとな", mode: "write" },
        ],
      },
    },
    // 海 (col 1 cell 6, 残り 1 cell)
    { id: "q8", spec: { cells: [{ kind: "guided", char: "海", mode: "write" }] } },
    // ★ ふりがな付きの block が col 末をまたいで分割される確認ポイント。
    //    図書館 (3 cells) + ふりがな としょかん。 col 1 残り 1 cell + col 2 先頭 2 cells に分割。
    {
      id: "q9",
      spec: {
        cells: [
          { kind: "guided", char: "図", mode: "write" },
          { kind: "guided", char: "書", mode: "write" },
          { kind: "guided", char: "館", mode: "write" },
        ],
        annotations: [
          { cellRange: [0, 2], expected: "としょかん", mode: "write" },
        ],
      },
    },
    // free としょかん (col 2 残り)
    {
      id: "q10",
      spec: { cells: [{ kind: "free", expected: "としょかん", mode: "write", span: 5 }] },
    },
    // 春夏秋冬 + はるなつあきふゆ (col 3)
    {
      id: "q11",
      spec: {
        cells: [
          { kind: "guided", char: "春", mode: "write" },
          { kind: "guided", char: "夏", mode: "write" },
          { kind: "guided", char: "秋", mode: "write" },
          { kind: "guided", char: "冬", mode: "write" },
        ],
        annotations: [
          { cellRange: [0, 3], expected: "はるなつあきふゆ", mode: "write" },
        ],
      },
    },
    // free にほんご (col 3 残り)
    {
      id: "q12",
      spec: { cells: [{ kind: "free", expected: "にほんご", mode: "write", span: 4 }] },
    },
    // 海空 + うみそら (col 4)
    {
      id: "q13",
      spec: {
        cells: [
          { kind: "guided", char: "海", mode: "write" },
          { kind: "guided", char: "空", mode: "write" },
        ],
        annotations: [
          { cellRange: [0, 1], expected: "うみそら", mode: "write" },
        ],
      },
    },
  ];
}

function rebuild() {
  currentPage?.destroy();
  hostEl.replaceChildren();
  clearLog();
  statusEl.textContent = "";

  const entries = blocks();
  log(`build: blocks=${entries.length}`);

  currentPage = page.create(hostEl, {
    writingMode: "vertical-rl",
    columns: 5,
    cellsPerColumn: 8,
    cellSize: 96,
    blocks: entries,
    loaders: { charDataLoader: cachedCharDataLoader },
    logger: (msg) => log(msg),
    onCellComplete: (blockIndex, cellIndex, kind, result) => {
      const ok = result.matched;
      if (result.kind === "guided") {
        log(
          `block#${blockIndex} ${kind}#${cellIndex} ${result.kind} ${ok ? "OK" : "NG"} mistakes=${result.mistakes}`,
          ok ? "ok" : "ng",
        );
      } else {
        log(
          `block#${blockIndex} ${kind}#${cellIndex} ${result.kind} ${ok ? "OK" : "NG"} candidate=${result.candidate ?? "-"} similarity=${result.similarity.toFixed(2)}`,
          ok ? "ok" : "ng",
        );
      }
    },
    onBlockComplete: (blockIndex, result) => {
      log(
        `block#${blockIndex} ${result.matched ? "OK" : "NG"} (cells=${result.perCell.length}, annotations=${result.perAnnotation.length})`,
        result.matched ? "ok" : "ng",
      );
    },
    onPageComplete: (result) => {
      const summary = `page ${result.matched ? "OK" : "NG"} (blocks=${result.perBlock.length})`;
      statusEl.textContent = summary;
      log(summary, result.matched ? "ok" : "ng");
    },
  });
}

resetBtn.addEventListener("click", () => {
  if (!currentPage) {
    return;
  }
  log("reset");
  statusEl.textContent = "";
  currentPage.reset();
});

rebuild();
