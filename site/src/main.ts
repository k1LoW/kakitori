import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { setupHero } from "./hero.js";
import { setupChar } from "./char.js";
import { setupBlock } from "./block.js";
import { setupPage } from "./page.js";
import { setupSizing } from "./sizing.js";
import { setupRestoreDemo } from "./restore.js";

async function highlightCodeBlocks() {
  const blocks = Array.from(
    document.querySelectorAll<HTMLElement>("pre[data-lang]"),
  );
  if (blocks.length === 0) {
    return;
  }

  const highlighter = await createHighlighterCore({
    themes: [import("@shikijs/themes/github-dark")],
    langs: [
      import("@shikijs/langs/typescript"),
      import("@shikijs/langs/bash"),
    ],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });

  for (const pre of blocks) {
    const code = pre.textContent ?? "";
    const lang = pre.dataset.lang ?? "text";
    const html = highlighter.codeToHtml(code, {
      lang,
      theme: "github-dark",
    });
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const replacement = wrapper.firstElementChild;
    if (replacement) {
      pre.replaceWith(replacement);
    }
  }
}

void highlightCodeBlocks();

const heroSection = document.getElementById("hero-section");
if (heroSection) {
  setupHero(heroSection);
}

const charSection = document.getElementById("char-section");
if (charSection) {
  setupChar(charSection);
}

const blockSection = document.getElementById("block-section");
if (blockSection) {
  setupBlock(blockSection);
}

const pageSection = document.getElementById("page-section");
if (pageSection) {
  setupPage(pageSection);
}

const sizingSection = document.getElementById("sizing-section");
if (sizingSection) {
  setupSizing(sizingSection);
}

const restoreSection = document.getElementById("restore-section");
if (restoreSection) {
  setupRestoreDemo(restoreSection);
}
