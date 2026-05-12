import { defaultCharDataLoader } from "@k1low/kakitori";
import type { CharDataLoaderFn } from "@k1low/kakitori";
import { block, type Block, type BlockSpec } from "@k1low/kakitori/block";

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

const hostEl = document.getElementById("block-host")!;
const logEl = document.getElementById("log")!;
const statusEl = document.getElementById("status")!;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;
const undoBtn = document.getElementById("undo") as HTMLButtonElement;
const statusBtn = document.getElementById("status-btn") as HTMLButtonElement;
const useCaseSelect = document.getElementById("usecase") as HTMLSelectElement;

let currentBlock: Block | null = null;

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

function specForUseCase(uc: string): BlockSpec {
  switch (uc) {
    case "1":
      return {
        cells: [
          { kind: "guided", char: "学", mode: "write" },
          { kind: "guided", char: "校", mode: "write" },
        ],
      };
    case "2":
      return {
        cells: [
          { kind: "guided", char: "学", mode: "write" },
          { kind: "guided", char: "校", mode: "show" },
        ],
      };
    case "3":
      return {
        cells: [
          { kind: "free", expected: "がっこう", mode: "write" },
        ],
      };
    case "4":
      return {
        cells: [
          { kind: "free", expected: "がっ", mode: "write" },
          { kind: "guided", char: "校", mode: "show" },
        ],
      };
    case "5":
      return {
        cells: [
          { kind: "guided", char: "学", mode: "write" },
          { kind: "guided", char: "校", mode: "write" },
        ],
        annotations: [
          { cellRange: [0, 1], expected: "がっこう", mode: "write" },
        ],
      };
    case "6":
      return {
        cells: [
          { kind: "guided", char: "学", mode: "write" },
          { kind: "guided", char: "校", mode: "show" },
        ],
        annotations: [
          { cellRange: [0, 1], expected: "がっこう", mode: "write" },
        ],
      };
    case "7":
      return {
        cells: [
          { kind: "guided", char: "学", mode: "show" },
          { kind: "guided", char: "校", mode: "show" },
        ],
        annotations: [
          { cellRange: [0, 1], expected: "がっこう", mode: "write" },
        ],
      };
    case "8":
      return {
        cells: [
          { kind: "guided", char: "学", mode: "write", overrides: { showOutline: false } },
          { kind: "guided", char: "校", mode: "write", overrides: { showOutline: false } },
        ],
      };
  }
  throw new Error(`unknown use case: ${uc}`);
}

function rebuild() {
  currentBlock?.destroy();
  hostEl.replaceChildren();
  clearLog();
  statusEl.textContent = "";

  const spec = specForUseCase(useCaseSelect.value);
  log(`build use case ${useCaseSelect.value}: cells=${spec.cells.length} annotations=${spec.annotations?.length ?? 0}`);

  currentBlock = block.create(hostEl, {
    spec,
    cellSize: 140,
    loaders: { charDataLoader: cachedCharDataLoader },
    logger: (msg) => log(msg),
    showSegmentBoxes: true,
    onCellComplete: (index, kind, chars) => {
      const ok = chars.every((c) => c.matched);
      const summary = chars
        .map((c) => `${c.character}${c.matched ? "✓" : "✗"}`)
        .join("");
      log(
        `${kind}#${index} ${ok ? "OK" : "NG"} chars=${summary || "-"}`,
        ok ? "ok" : "ng",
      );
    },
    onBlockComplete: (snapshot) => {
      const summary = `block ${snapshot.matched ? "OK" : "NG"} (cells=${snapshot.cells.length}, annotations=${snapshot.annotations.length})`;
      statusEl.textContent = summary;
      log(summary, snapshot.matched ? "ok" : "ng");
    },
  });
}

resetBtn.addEventListener("click", () => {
  if (!currentBlock) {
    return;
  }
  log("reset");
  statusEl.textContent = "";
  currentBlock.reset();
});

undoBtn.addEventListener("click", () => {
  if (!currentBlock) {
    return;
  }
  const undone = currentBlock.undo();
  if (undone) {
    log(`undo ${undone.kind}#${undone.index}`);
    statusEl.textContent = "";
  } else {
    log("undo (nothing to undo)");
  }
});

statusBtn.addEventListener("click", () => {
  if (!currentBlock) {
    return;
  }
  log(`result: ${JSON.stringify(currentBlock.result())}`);
});

useCaseSelect.addEventListener("change", rebuild);

rebuild();
