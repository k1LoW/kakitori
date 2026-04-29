import { Kakitori, defaultCharDataLoader } from "@k1low/kakitori";
import type { KakitoriStrokeData } from "@k1low/kakitori";

const writerEl = document.getElementById("writer")!;
const charInput = document.getElementById("char-input") as HTMLInputElement;
const quizBtn = document.getElementById("quiz-btn")!;
const animateBtn = document.getElementById("animate-btn")!;
const resultEl = document.getElementById("result")!;
const logEl = document.getElementById("log")!;

let kakitori: Kakitori | null = null;
let highlightIdx = -1;

function log(msg: string) {
  const now = performance.now();
  const ms = String(Math.floor(now) % 10000).padStart(4, "0");
  logEl.textContent += `[${ms}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function createKakitori(char: string) {
  writerEl.innerHTML = "";
  resultEl.textContent = "";
  logEl.textContent = "";
  highlightIdx = -1;

  // Config (strokeGroups, strokeEndings) is auto-loaded from @k1low/kakitori-data
  kakitori = Kakitori.create(writerEl, char, {
    width: 300,
    height: 300,
    charDataLoader: defaultCharDataLoader,
    logger: log,
    onCorrectStroke: (data: KakitoriStrokeData) => {
      if (data.strokeEnding) {
        const icon = data.strokeEnding.correct ? "OK" : "NG";
        resultEl.textContent += `${data.strokeNum + 1}: ${data.strokeEnding.expected} ${icon}  `;
      }
    },
    onComplete: (data) => {
      resultEl.textContent += `\nDone! Mistakes: ${data.totalMistakes}, Stroke ending mistakes: ${data.strokeEndingMistakes}`;
    },
  });
}

// Click on stroke to highlight
writerEl.addEventListener("click", (e) => {
  if (!kakitori) return;
  const idx = kakitori.getStrokeIndexAtPoint(e.clientX, e.clientY);
  if (idx !== null) {
    kakitori.resetStrokeColors();
    kakitori.highlightStroke(idx, "#c00");
    resultEl.textContent = `Stroke ${idx + 1} selected`;
    highlightIdx = idx;
    log(`click: stroke ${idx + 1} highlighted`);
  }
});

// Sequential highlight button
const highlightBtn = document.createElement("button");
highlightBtn.textContent = "次の画";
document.querySelector(".controls")!.appendChild(highlightBtn);
highlightBtn.addEventListener("click", () => {
  if (!kakitori) return;
  const count = kakitori.getLogicalStrokeCount();
  if (count === 0) return;
  kakitori.resetStrokeColors();
  highlightIdx = (highlightIdx + 1) % count;
  kakitori.highlightStroke(highlightIdx, "#c00");
  resultEl.textContent = `Stroke ${highlightIdx + 1} / ${count}`;
  log(`highlight: stroke ${highlightIdx + 1}/${count}`);
});

quizBtn.addEventListener("click", () => {
  const char = charInput.value.trim();
  if (!char) return;
  createKakitori(char);
  kakitori?.quiz();
});

animateBtn.addEventListener("click", () => {
  const char = charInput.value.trim();
  if (!char) return;
  createKakitori(char);
  kakitori?.animateCharacter();
});

createKakitori(charInput.value);
