import { char, defaultCharDataLoader } from "@k1low/kakitori";
import type {
  Char,
  CharDataLoaderFn,
  CharJudgeStrokeResult,
  CharStrokeData,
} from "@k1low/kakitori";

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

const TARGET_CHARACTER = "あ";

const writerEl = document.getElementById("writer")!;
const strokeResultsEl = document.getElementById("stroke-results")!;
const resetBtn = document.getElementById("reset-btn")!;
const statusEl = document.getElementById("status")!;

let mountChar: Char | null = null;
let judgeChar: Char | null = null;
let eventSeq = 0;
// Char.judge() mutates shared JudgerState (capture slot, quiz._userStroke,
// quiz._currentStrokeIndex), so concurrent calls on the same instance race
// and can mislabel results. Mount callbacks are not awaited, so a fast
// drawer can stack recordEvent() runs — serialize their judge calls
// through a promise chain.
let judgeQueue: Promise<void> = Promise.resolve();

interface StrokeEvent {
  seq: number;
  source: "correct" | "mistake" | "ending-mistake";
  mount: CharStrokeData;
  judgeResult: CharJudgeStrokeResult | null;
  judgeError: string | null;
}

const events: StrokeEvent[] = [];

function setStatus(msg: string) {
  statusEl.textContent = msg;
}

function ensureJudgeChar(): Char {
  if (!judgeChar) {
    judgeChar = char.create(TARGET_CHARACTER, {
      charDataLoader: cachedCharDataLoader,
    });
  }
  return judgeChar;
}

function fmtNum(n: number, digits = 3): string {
  if (!Number.isFinite(n)) {
    return String(n);
  }
  return n.toFixed(digits);
}

function endingSummary(
  e:
    | CharStrokeData["strokeEnding"]
    | CharJudgeStrokeResult["strokeEnding"],
): string {
  if (!e) {
    return "—";
  }
  return `correct=${e.correct} types=${e.expected ?? "-"} velocity=${e.velocityProfile} conf=${fmtNum(e.confidence, 2)}`;
}

function diverged(ev: StrokeEvent): boolean {
  if (!ev.judgeResult) {
    return false;
  }
  if (ev.judgeResult.matched !== ev.mount.matched) {
    return true;
  }
  const me = ev.mount.strokeEnding;
  const je = ev.judgeResult.strokeEnding;
  if (!!me !== !!je) {
    return true;
  }
  if (me && je && me.correct !== je.correct) {
    return true;
  }
  return false;
}

function renderEvents() {
  if (events.length === 0) {
    strokeResultsEl.innerHTML =
      '<div class="empty">Draw a stroke to see results.</div>';
    return;
  }
  strokeResultsEl.innerHTML = "";
  for (const ev of events) {
    const card = document.createElement("div");
    card.className = "stroke-card" + (diverged(ev) ? " diverged" : "");

    const head = document.createElement("div");
    head.className = "stroke-card-head";
    head.innerHTML = `<span class="num">#${ev.seq} stroke ${ev.mount.strokeNum + 1} (${ev.source})</span>`;
    const verdict = document.createElement("span");
    if (ev.judgeError) {
      verdict.className = "verdict diff";
      verdict.textContent = "judge error";
    } else if (!ev.judgeResult) {
      verdict.className = "verdict";
      verdict.textContent = "judging…";
    } else if (diverged(ev)) {
      verdict.className = "verdict diff";
      verdict.textContent = "diverged";
    } else {
      verdict.className = "verdict match";
      verdict.textContent = "converged";
    }
    head.appendChild(verdict);
    card.appendChild(head);

    const compare = document.createElement("div");
    compare.className = "compare";

    const mountMatched = String(ev.mount.matched);
    const mountSim = fmtNum(ev.mount.similarity);
    const mountEnding = endingSummary(ev.mount.strokeEnding);
    const judgeMatched = ev.judgeResult ? String(ev.judgeResult.matched) : "…";
    const judgeSim = ev.judgeResult ? fmtNum(ev.judgeResult.similarity) : "…";
    const judgeEnding = ev.judgeResult
      ? endingSummary(ev.judgeResult.strokeEnding)
      : "…";

    const matchedDiffers =
      ev.judgeResult && ev.judgeResult.matched !== ev.mount.matched;
    const endingDiffers =
      ev.judgeResult &&
      (!!ev.judgeResult.strokeEnding !== !!ev.mount.strokeEnding ||
        (ev.judgeResult.strokeEnding &&
          ev.mount.strokeEnding &&
          ev.judgeResult.strokeEnding.correct !==
            ev.mount.strokeEnding.correct));

    compare.innerHTML = `
      <div class="label col-head"></div>
      <div class="col-head">mount</div>
      <div class="col-head">judge</div>
      <div class="label">matched</div>
      <div${matchedDiffers ? ' class="diff-cell"' : ""}>${mountMatched}</div>
      <div${matchedDiffers ? ' class="diff-cell"' : ""}>${judgeMatched}</div>
      <div class="label">similarity</div>
      <div>${mountSim}</div>
      <div>${judgeSim}</div>
      <div class="label">ending</div>
      <div${endingDiffers ? ' class="diff-cell"' : ""}>${mountEnding}</div>
      <div${endingDiffers ? ' class="diff-cell"' : ""}>${judgeEnding}</div>
      <div class="label">points</div>
      <div class="span2">${ev.mount.points.length} (shared input — judge() ran on the same TimedPoint[])</div>
    `;
    card.appendChild(compare);
    strokeResultsEl.appendChild(card);
  }
}

async function recordEvent(
  source: StrokeEvent["source"],
  data: CharStrokeData,
) {
  const ev: StrokeEvent = {
    seq: ++eventSeq,
    source,
    mount: data,
    judgeResult: null,
    judgeError: null,
  };
  events.push(ev);
  renderEvents();

  judgeQueue = judgeQueue.then(async () => {
    const headless = ensureJudgeChar();
    try {
      await headless.ready();
      ev.judgeResult = await headless.judge(data.strokeNum, data.points);
    } catch (err) {
      ev.judgeError = err instanceof Error ? err.message : String(err);
    }
    renderEvents();
  });
  await judgeQueue;
}

async function start() {
  mountChar?.destroy();
  judgeChar?.destroy();
  events.length = 0;
  eventSeq = 0;
  judgeChar = null;
  // Drop any tail of in-flight judge() work from the previous session so
  // the new session's events are not serialized behind it.
  judgeQueue = Promise.resolve();
  writerEl.innerHTML = "";
  renderEvents();
  setStatus("loading…");

  mountChar = char.create(TARGET_CHARACTER, {
    charDataLoader: cachedCharDataLoader,
  });
  mountChar.mount(writerEl, {
    size: 300,
    drawingWidth: 12,
    showGrid: true,
    onCorrectStroke: (data) => recordEvent("correct", data),
    onMistake: (data) => recordEvent("mistake", data),
    onStrokeEndingMistake: (data) => recordEvent("ending-mistake", data),
    onComplete: () => setStatus("complete — reset to try again"),
  });

  await mountChar.ready();
  mountChar.start();
  setStatus("draw the strokes");
}

resetBtn.addEventListener("click", () => {
  start();
});

start();
