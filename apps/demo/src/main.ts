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

// 永 (永字八法): tome, hane, harai が全て含まれる
const sampleStrokeEndings: Record<string, StrokeEnding[]> = {
  永: [
    { type: "tome", direction: null },                 // stroke 0: 点 (dot)
    { type: "hane", direction: [-0.87, 0.49] },        // stroke 1: 竪鉤 (vertical hook)
    { type: "harai", direction: [-0.75, -0.66] },      // stroke 2: 掠 (left sweep)
    { type: "harai", direction: [-0.80, -0.60] },      // stroke 3: 啄 (short left)
    { type: "harai", direction: [0.99, -0.17] },       // stroke 4: 磔 (right sweep)
  ],
};

function createKakitori(char: string) {
  writerEl.innerHTML = "";
  resultEl.textContent = "";
  logEl.textContent = "";

  kakitori = Kakitori.create(writerEl, char, {
    width: 300,
    height: 300,
    charDataLoader: defaultCharDataLoader,
    logger: log,
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

  const endings = sampleStrokeEndings[char];
  if (endings) {
    kakitori.setStrokeEndings(endings);
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
