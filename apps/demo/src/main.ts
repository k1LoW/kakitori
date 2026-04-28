import { Kakitori, defaultCharDataLoader } from "@k1low/kakitori";
import type { KakitoriStrokeData, StrokeEnding } from "@k1low/kakitori";

const writerEl = document.getElementById("writer")!;
const charInput = document.getElementById("char-input") as HTMLInputElement;
const quizBtn = document.getElementById("quiz-btn")!;
const animateBtn = document.getElementById("animate-btn")!;
const resultEl = document.getElementById("result")!;
const logEl = document.getElementById("log")!;

let kakitori: Kakitori | null = null;

function log(msg: string) {
  const now = performance.now();
  const ms = String(Math.floor(now) % 10000).padStart(4, "0");
  logEl.textContent += `[${ms}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// Per-character config: strokeGroups + strokeEndings
const charConfigs: Record<string, {
  strokeGroups?: number[][];
  strokeEndings?: StrokeEnding[];
}> = {
  あ: {
    // Data has 4 strokes, but あ is actually 3 strokes. Strokes 2+3 are one stroke.
    strokeGroups: [[0], [1], [2, 3]],
    strokeEndings: [
      { type: "harai", direction: [0.76, -0.65] },
      { type: "tome", direction: null },
      { type: "tome", direction: null },
    ],
  },
  永: {
    strokeEndings: [
      { type: "tome", direction: null },
      { type: "hane", direction: [-0.87, 0.49] },
      { type: "harai", direction: [-0.75, -0.66] },
      { type: "harai", direction: [-0.80, -0.60] },
      { type: "harai", direction: [0.99, -0.17] },
    ],
  },
};

function createKakitori(char: string) {
  writerEl.innerHTML = "";
  resultEl.textContent = "";
  logEl.textContent = "";

  const config = charConfigs[char];

  kakitori = Kakitori.create(writerEl, char, {
    width: 300,
    height: 300,
    charDataLoader: defaultCharDataLoader,
    logger: log,
    strokeGroups: config?.strokeGroups,
    onCorrectStroke: (data: KakitoriStrokeData) => {
      if (data.strokeEnding) {
        const icon = data.strokeEnding.correct ? "OK" : "NG";
        resultEl.textContent = `Stroke ${data.strokeNum + 1}: ${data.strokeEnding.expected} ${icon}`;
      }
    },
    onComplete: (data) => {
      resultEl.textContent = `Done! Mistakes: ${data.totalMistakes}, Stroke ending mistakes: ${data.strokeEndingMistakes}`;
    },
  });

  if (config?.strokeEndings) {
    kakitori.setStrokeEndings(config.strokeEndings);
  }
}

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
