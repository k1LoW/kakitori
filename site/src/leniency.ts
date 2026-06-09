import {
  char,
  defaultCharDataLoader,
  defaultConfigLoader,
} from "@k1low/kakitori";
import type {
  Char,
  CharacterConfig,
  CharDataLoaderFn,
  CharStrokeData,
  ConfigLoaderFn,
} from "@k1low/kakitori";

// Independent loader caches so a remount on every slider tick does not
// retrigger an unpkg fetch. char.ts and sizing.ts have their own caches
// kept deliberately separate (this module stays self-contained the same
// way sizing.ts does).
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

const LENIENCY_CHAR = "学";
const LENIENCY_SIZE = 240;
const LENIENCY_DEFAULT = 1.0;

export function setupLeniency(root: HTMLElement): void {
  const slider = root.querySelector<HTMLInputElement>("#leniency-slider");
  const valueOut = root.querySelector<HTMLOutputElement>("#leniency-value");
  const writerEl = root.querySelector<HTMLElement>("#leniency-writer");
  const statusEl = root.querySelector<HTMLElement>(
    '[data-status-for="leniency"]',
  );
  const resetBtn = root.querySelector<HTMLButtonElement>("#leniency-reset");
  if (!slider || !valueOut || !writerEl || !statusEl || !resetBtn) {
    return;
  }

  let chips: HTMLElement[] = [];

  function renderChips(strokeCount: number) {
    statusEl!.replaceChildren();
    chips = [];
    for (let i = 0; i < strokeCount; i++) {
      const chip = document.createElement("span");
      chip.className = "char-example-chip";
      chip.textContent = String(i + 1);
      statusEl!.appendChild(chip);
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

  let instance: Char | null = null;

  function rebuild(leniency: number) {
    valueOut!.value = leniency.toFixed(1);
    if (instance) {
      try {
        instance.destroy();
      } catch (err) {
        console.error("[leniency] destroy() failed:", err);
      }
    }
    writerEl!.style.width = `${LENIENCY_SIZE}px`;
    writerEl!.style.height = `${LENIENCY_SIZE}px`;
    const c = char.create(LENIENCY_CHAR, {
      charDataLoader: cachedCharDataLoader,
      configLoader: cachedConfigLoader,
      leniency,
    });
    c.mount(writerEl!, {
      size: LENIENCY_SIZE,
      drawingWidth: 6,
      retainStrokes: true,
      showAcceptedStroke: false,
      onCorrectStroke: (data: CharStrokeData) => markChip(data.strokeNum, "ok"),
      onMistake: (data: CharStrokeData) => markChip(data.strokeNum, "ng"),
    });
    instance = c;
    // Wait for config so the quiz arms before the chip row materializes.
    // Char data is fetched separately and may still be pending — poll
    // getLogicalStrokeCount the same way char.ts does for its examples
    // so the chips don't paint 0 against a not-yet-parsed character.
    //
    // Staleness guard: a fast Restart click or slider release while the
    // initial fetch is still in flight can stack a second rebuild() that
    // destroys this `c` before its `ready()` resolves. Compare against
    // the outer `instance` ref on every entry so the resolved callback
    // (and each polling tick) bails out instead of poking a destroyed
    // Char — getLogicalStrokeCount() / start() would otherwise run on
    // an unmounted instance.
    const readyPromise = c.ready();
    readyPromise.catch((err: unknown) => {
      console.error("[leniency] ready() failed:", err);
    });
    void readyPromise.then(() => {
      if (instance !== c) {
        return;
      }
      const tryRender = (remaining: number) => {
        if (instance !== c) {
          return;
        }
        const count = c.getLogicalStrokeCount();
        if (count > 0) {
          renderChips(count);
          return;
        }
        if (remaining > 0) {
          setTimeout(() => tryRender(remaining - 1), 30);
          return;
        }
        console.warn(
          "[leniency] getLogicalStrokeCount stayed 0; char data may not have loaded",
        );
      };
      tryRender(200);
      c.start();
    }, () => {});
  }

  // Live value text follows the drag continuously; the writer is only
  // rebuilt on slider release (change). Continuous rebuilds during a
  // drag race hanzi-writer's async quiz setup and can leave the cell
  // unwritable (same caveat sizing.ts documents).
  slider.addEventListener("input", () => {
    valueOut!.value = Number(slider.value).toFixed(1);
  });
  slider.addEventListener("change", () => {
    const next = Number(slider.value);
    if (!Number.isFinite(next) || next <= 0) {
      return;
    }
    rebuild(next);
  });

  resetBtn.addEventListener("click", () => {
    clearChips();
    rebuild(Number(slider.value) || LENIENCY_DEFAULT);
  });

  rebuild(LENIENCY_DEFAULT);
}
