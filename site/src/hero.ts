import { char, defaultCharDataLoader } from "@k1low/kakitori";
import type { Char, CharDataLoaderFn } from "@k1low/kakitori";
import { block, type Block } from "@k1low/kakitori/block";

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

export function setupHero(root: HTMLElement): void {
  const isOgp =
    new URLSearchParams(window.location.search).get("ogp") !== null;
  if (isOgp) {
    document.body.classList.add("ogp");
  }

  const blockTarget = root.querySelector<HTMLElement>("#hero-block")!;
  const heroBlock: Block = block.create(blockTarget, {
    spec: {
      cells: [
        { kind: "guided", char: "書", mode: "show" },
        { kind: "guided", char: "き", mode: "show" },
        { kind: "guided", char: "取", mode: "show" },
        { kind: "guided", char: "り", mode: "show" },
      ],
      annotations: [
        { cellRange: [0, 0], expected: "か", mode: "show" },
        { cellRange: [2, 2], expected: "と", mode: "show" },
      ],
    },
    cellSize: 88,
    loaders: { charDataLoader: cachedCharDataLoader },
  });
  // Keep a reference so the block is not GC'd / unused-warning'd.
  void heroBlock;

  const aTarget = root.querySelector<HTMLElement>("#hero-a")!;
  let aChar: Char | null = null;

  function play() {
    if (!aChar) {
      return;
    }
    void aChar.ready().then(() => {
      aChar?.animate();
    });
  }

  function build() {
    aChar?.destroy();
    aTarget.replaceChildren();
    aChar = char.create("永", { charDataLoader: cachedCharDataLoader });
    aChar.mount(aTarget, {
      size: 480,
      showGrid: true,
      drawingWidth: 14,
    });
    play();
  }

  build();

  const replayBtn = root.querySelector<HTMLButtonElement>("#hero-replay");
  if (replayBtn) {
    replayBtn.addEventListener("click", play);
  }
}
