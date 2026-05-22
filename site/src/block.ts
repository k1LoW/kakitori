import { defaultCharDataLoader } from "@k1low/kakitori";
import type { CharDataLoaderFn } from "@k1low/kakitori";
import { block, type Block, type BlockSpec } from "@k1low/kakitori/block";

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

export function setupBlock(root: HTMLElement): void {
  const hostEl = root.querySelector<HTMLElement>("#block-host")!;
  const logEl = root.querySelector<HTMLElement>("#block-log")!;
  const statusEl = root.querySelector<HTMLElement>("#block-status")!;
  const resetBtn = root.querySelector<HTMLButtonElement>("#block-reset")!;
  const undoBtn = root.querySelector<HTMLButtonElement>("#block-undo")!;
  const statusBtn = root.querySelector<HTMLButtonElement>("#block-status-btn")!;

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

  // The live example mirrors the code sample at the top of the
  // section: two guided cells (学校) plus a write-mode furigana
  // strip (がっこう). Specific configuration variants moved to the
  // Examples section below; this demo focuses on the log + Reset /
  // Undo / Status interactions on a single representative spec.
  const liveExampleSpec: BlockSpec = {
    cells: [
      { kind: "guided", char: "学", mode: "write" },
      { kind: "guided", char: "校", mode: "write" },
    ],
    annotations: [
      { cellRange: [0, 1], expected: "がっこう", mode: "write" },
    ],
  };

  function rebuild() {
    currentBlock?.destroy();
    hostEl.replaceChildren();
    clearLog();
    statusEl.textContent = "";

    log(
      `build: cells=${liveExampleSpec.cells.length} annotations=${liveExampleSpec.annotations?.length ?? 0}`,
    );

    const correction = "per-stroke" as const;
    currentBlock = block.create(hostEl, {
      spec: liveExampleSpec,
      cellSize: 140,
      loaders: { charDataLoader: cachedCharDataLoader },
      logger: (msg) => log(msg),
      showSegmentBoxes: true,
      correction,
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

  rebuild();

  setupBlockExamples(root);
}

type BlockExampleKey =
  | "normal"
  | "show-write"
  | "free"
  | "annotated"
  | "per-block";

interface BlockExampleConfig {
  key: BlockExampleKey;
  /** Cell-count hint for the initial chip row before onCellComplete fires. */
  cellCount: number;
  build: () => Parameters<typeof block.create>[1];
}

const BLOCK_EXAMPLE_CELL_SIZE = 140;

const BLOCK_EXAMPLES: BlockExampleConfig[] = [
  {
    key: "normal",
    cellCount: 2,
    build: () => ({
      spec: {
        cells: [
          { kind: "guided", char: "学", mode: "write" },
          { kind: "guided", char: "校", mode: "write" },
        ],
      },
      cellSize: BLOCK_EXAMPLE_CELL_SIZE,
      loaders: { charDataLoader: cachedCharDataLoader },
    }),
  },
  {
    key: "show-write",
    cellCount: 2,
    build: () => ({
      spec: {
        cells: [
          { kind: "guided", char: "学", mode: "show" },
          { kind: "guided", char: "校", mode: "write" },
        ],
      },
      cellSize: BLOCK_EXAMPLE_CELL_SIZE,
      loaders: { charDataLoader: cachedCharDataLoader },
    }),
  },
  {
    key: "free",
    cellCount: 1,
    build: () => ({
      spec: {
        // "学校" is 2 characters but `span: 3` reserves 3 grid slots,
        // demonstrating that free cells decouple visible width from
        // answer length.
        cells: [{ kind: "free", expected: "学校", mode: "write", span: 3 }],
      },
      cellSize: BLOCK_EXAMPLE_CELL_SIZE,
      loaders: { charDataLoader: cachedCharDataLoader },
    }),
  },
  {
    key: "annotated",
    cellCount: 2,
    build: () => ({
      spec: {
        cells: [
          { kind: "guided", char: "学", mode: "write" },
          { kind: "guided", char: "校", mode: "write" },
        ],
        annotations: [
          { cellRange: [0, 1], expected: "がっこう", mode: "write" },
        ],
      },
      cellSize: BLOCK_EXAMPLE_CELL_SIZE,
      loaders: { charDataLoader: cachedCharDataLoader },
    }),
  },
  {
    key: "per-block",
    cellCount: 2,
    build: () => ({
      spec: {
        cells: [
          { kind: "guided", char: "学", mode: "write" },
          { kind: "guided", char: "校", mode: "write" },
        ],
      },
      cellSize: BLOCK_EXAMPLE_CELL_SIZE,
      correction: "per-block",
      loaders: { charDataLoader: cachedCharDataLoader },
    }),
  },
];

function setupBlockExamples(root: HTMLElement): void {
  for (const config of BLOCK_EXAMPLES) {
    const hostEl = root.querySelector<HTMLElement>(
      `#block-example-${config.key}`,
    );
    if (!hostEl) {
      continue;
    }
    const host = hostEl;
    const statusEl = root.querySelector<HTMLElement>(
      `[data-block-status-for="${config.key}"]`,
    );

    let chips: HTMLElement[] = [];
    function renderChips() {
      if (!statusEl) {
        return;
      }
      statusEl.replaceChildren();
      chips = [];
      for (let i = 0; i < config.cellCount; i++) {
        const chip = document.createElement("span");
        chip.className = "block-example-chip";
        chip.textContent = String(i + 1);
        statusEl.appendChild(chip);
        chips.push(chip);
      }
    }
    function markChip(index: number, kind: "ok" | "ng") {
      const chip = chips[index];
      if (!chip) {
        return;
      }
      chip.classList.remove("ok", "ng");
      chip.classList.add(kind);
    }

    let instance: Block | null = null;
    function build() {
      instance?.destroy();
      host.replaceChildren();
      renderChips();
      const opts = config.build();
      const userOnCellComplete = opts.onCellComplete;
      instance = block.create(host, {
        ...opts,
        onCellComplete: (index, kind, chars) => {
          userOnCellComplete?.(index, kind, chars);
          // Mark the cell chip from the first chars[].matched roll-up;
          // annotation completions land on the same `index` as cells in
          // the matched/non-matched sense but render to a separate
          // strip — we only mark the cell row here to keep the chip
          // count aligned with `config.cellCount`.
          if (kind !== "cell") {
            return;
          }
          const ok = chars.every((c) => c.matched);
          markChip(index, ok ? "ok" : "ng");
        },
      });
    }
    build();

    root
      .querySelectorAll<HTMLButtonElement>(
        `[data-block-example="${config.key}"][data-action="reset"]`,
      )
      .forEach((btn) => {
        btn.addEventListener("click", build);
      });
  }
}
