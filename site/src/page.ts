import { defaultCharDataLoader } from "@k1low/kakitori";
import type { CharDataLoaderFn } from "@k1low/kakitori";
import { page, type Page, type PageBlockEntry } from "@k1low/kakitori/page";

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

function blocks(): PageBlockEntry[] {
  return [
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
    {
      id: "q3",
      spec: {
        cells: [
          { kind: "guided", char: "天", mode: "write" },
          { kind: "guided", char: "気", mode: "show" },
        ],
        annotations: [{ cellRange: [0, 1], expected: "てんき", mode: "show" }],
      },
    },
    { id: "q4", spec: { cells: [{ kind: "guided", char: "山", mode: "write" }] } },
    { id: "q5", spec: { cells: [{ kind: "guided", char: "川", mode: "write" }] } },
    {
      id: "q6",
      spec: {
        cells: [
          { kind: "free", expected: "がっこう", mode: "write", span: 4 },
        ],
      },
    },
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
    { id: "q8", spec: { cells: [{ kind: "guided", char: "海", mode: "write" }] } },
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
    {
      id: "q10",
      spec: { cells: [{ kind: "blank", span: 5 }] },
    },
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
          {
            cellRange: [0, 3],
            expected: "はるなつあきふゆ",
            mode: "write",
          },
        ],
      },
    },
    {
      id: "q12",
      spec: {
        cells: [
          { kind: "free", expected: "にほんご", mode: "write", span: 4 },
        ],
      },
    },
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

export function setupPage(root: HTMLElement): void {
  const hostEl = root.querySelector<HTMLElement>("#page-host")!;
  const logEl = root.querySelector<HTMLElement>("#page-log")!;
  const statusEl = root.querySelector<HTMLElement>("#page-status")!;
  const resetBtn = root.querySelector<HTMLButtonElement>("#page-reset")!;
  const undoBtn = root.querySelector<HTMLButtonElement>("#page-undo")!;
  const statusBtn = root.querySelector<HTMLButtonElement>("#page-status-btn")!;
  const correctionSelect = root.querySelector<HTMLSelectElement>("#page-correction");
  const checkBtn = root.querySelector<HTMLButtonElement>("#page-check-btn");

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

  function rebuild() {
    currentPage?.destroy();
    hostEl.replaceChildren();
    clearLog();
    statusEl.textContent = "";

    const entries = blocks();
    log(`build: blocks=${entries.length}`);

    const correction = (correctionSelect?.value ?? "per-stroke") as
      | "per-stroke"
      | "per-char"
      | "per-block"
      | "per-page";
    currentPage = page.create(hostEl, {
      writingMode: "vertical-rl",
      columns: 5,
      cellsPerColumn: 8,
      cellSize: 96,
      blocks: entries,
      loaders: { charDataLoader: cachedCharDataLoader },
      logger: (msg) => log(msg),
      correction,
      onCellComplete: (blockIndex, cellIndex, kind, chars) => {
        const ok = chars.every((c) => c.matched);
        const summary = chars
          .map((c) => `${c.character}${c.matched ? "✓" : "✗"}`)
          .join("");
        log(
          `block#${blockIndex} ${kind}#${cellIndex} ${ok ? "OK" : "NG"} chars=${summary || "-"}`,
          ok ? "ok" : "ng",
        );
      },
      onBlockComplete: (blockIndex, snapshot) => {
        log(
          `block#${blockIndex} ${snapshot.matched ? "OK" : "NG"} (cells=${snapshot.cells.length}, annotations=${snapshot.annotations.length})`,
          snapshot.matched ? "ok" : "ng",
        );
      },
      onPageComplete: (snapshot) => {
        const summary = `page ${snapshot.matched ? "OK" : "NG"} (blocks=${snapshot.blocks.length})`;
        statusEl.textContent = summary;
        log(summary, snapshot.matched ? "ok" : "ng");
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

  undoBtn.addEventListener("click", () => {
    if (!currentPage) {
      return;
    }
    const undone = currentPage.undo();
    if (!undone) {
      log("undo (nothing to undo)");
      return;
    }
    if (undone.kind === "block-cell") {
      log(`undo block#${undone.blockIndex} cell#${undone.cellIndex}`);
    } else {
      log(
        `undo block#${undone.blockIndex} annotation#${undone.annotationIndex}`,
      );
    }
    statusEl.textContent = "";
  });

  statusBtn.addEventListener("click", () => {
    if (!currentPage) {
      return;
    }
    log(`result: ${JSON.stringify(currentPage.result())}`);
  });

  checkBtn?.addEventListener("click", () => {
    if (!currentPage) {
      return;
    }
    log("check (submit)");
    currentPage.check();
  });

  correctionSelect?.addEventListener("change", rebuild);

  rebuild();
}
