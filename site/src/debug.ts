import { char, defaultCharDataLoader } from "@k1low/kakitori";
import type {
  Char,
  CharDataLoaderFn,
  CharStrokeResult,
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
let checkChar: Char | null = null;
let eventSeq = 0;
// Char.checkStroke() mutates shared CheckerState (capture slot, quiz._userStroke,
// quiz._currentStrokeIndex), so concurrent calls on the same instance race
// and can mislabel results. Mount callbacks are not awaited, so a fast
// drawer can stack recordEvent() runs — serialize their check calls
// through a promise chain.
let checkQueue: Promise<void> = Promise.resolve();
// Bumped on every start() so queued tasks from an earlier session can detect
// they are stale and bail before recreating checkChar / racing with the new
// session's replays.
let sessionId = 0;

interface StrokeEvent {
  seq: number;
  source: "correct" | "mistake" | "ending-mistake";
  mount: CharStrokeData;
  checkResult: CharStrokeResult | null;
  checkError: string | null;
}

const events: StrokeEvent[] = [];

function setStatus(msg: string) {
  statusEl.textContent = msg;
}

function ensureCheckChar(): Char {
  if (!checkChar) {
    checkChar = char.create(TARGET_CHARACTER, {
      charDataLoader: cachedCharDataLoader,
    });
  }
  return checkChar;
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
    | CharStrokeResult["strokeEnding"],
): string {
  if (!e) {
    return "—";
  }
  return `correct=${e.correct} types=${e.expected ?? "-"} velocity=${e.velocityProfile} conf=${fmtNum(e.confidence, 2)}`;
}

function diverged(ev: StrokeEvent): boolean {
  if (!ev.checkResult) {
    return false;
  }
  if (ev.checkResult.matched !== ev.mount.matched) {
    return true;
  }
  const me = ev.mount.strokeEnding;
  const je = ev.checkResult.strokeEnding;
  if (!!me !== !!je) {
    return true;
  }
  if (me && je && me.correct !== je.correct) {
    return true;
  }
  return false;
}

function makeCell(text: string, className?: string): HTMLDivElement {
  const el = document.createElement("div");
  if (className) {
    el.className = className;
  }
  el.textContent = text;
  return el;
}

function renderEvents() {
  // Use textContent / appendChild instead of innerHTML so values that may
  // originate from remotely loaded character config (e.g. the strokeEnding
  // summary) cannot smuggle markup into the panel.
  strokeResultsEl.replaceChildren();
  if (events.length === 0) {
    strokeResultsEl.appendChild(makeCell("Draw a stroke to see results.", "empty"));
    return;
  }
  for (const ev of events) {
    const card = document.createElement("div");
    card.className = "stroke-card" + (diverged(ev) ? " diverged" : "");

    const head = document.createElement("div");
    head.className = "stroke-card-head";
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = `#${ev.seq} stroke ${ev.mount.strokeNum + 1} (${ev.source})`;
    head.appendChild(num);

    const verdict = document.createElement("span");
    if (ev.checkError) {
      verdict.className = "verdict diff";
      verdict.textContent = "check error";
    } else if (!ev.checkResult) {
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
    const checkMatched = ev.checkResult ? String(ev.checkResult.matched) : "…";
    const checkSim = ev.checkResult ? fmtNum(ev.checkResult.similarity) : "…";
    const checkEnding = ev.checkResult
      ? endingSummary(ev.checkResult.strokeEnding)
      : "…";

    const matchedDiffers =
      ev.checkResult && ev.checkResult.matched !== ev.mount.matched;
    const endingDiffers =
      ev.checkResult &&
      (!!ev.checkResult.strokeEnding !== !!ev.mount.strokeEnding ||
        (ev.checkResult.strokeEnding &&
          ev.mount.strokeEnding &&
          ev.checkResult.strokeEnding.correct !==
            ev.mount.strokeEnding.correct));
    const matchedClass = matchedDiffers ? "diff-cell" : undefined;
    const endingClass = endingDiffers ? "diff-cell" : undefined;

    compare.append(
      makeCell("", "label col-head"),
      makeCell("mount", "col-head"),
      makeCell("check", "col-head"),
      makeCell("matched", "label"),
      makeCell(mountMatched, matchedClass),
      makeCell(checkMatched, matchedClass),
      makeCell("similarity", "label"),
      makeCell(mountSim),
      makeCell(checkSim),
      makeCell("ending", "label"),
      makeCell(mountEnding, endingClass),
      makeCell(checkEnding, endingClass),
      makeCell("points", "label"),
      makeCell(
        `${ev.mount.points.length} (shared input — check() ran on the same TimedPoint[])`,
        "span2",
      ),
    );
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
    checkResult: null,
    checkError: null,
  };
  events.push(ev);
  renderEvents();

  // Capture the session at enqueue time. Each await inside the task
  // re-checks it so a Reset between awaits drops the stale task instead
  // of letting it touch a fresh checkChar.
  const taskSession = sessionId;
  checkQueue = checkQueue.then(async () => {
    if (taskSession !== sessionId) {
      return;
    }
    const headless = ensureCheckChar();
    try {
      await headless.ready();
      if (taskSession !== sessionId) {
        return;
      }
      ev.checkResult = await headless.checkStroke(data.strokeNum, data.points);
    } catch (err) {
      if (taskSession !== sessionId) {
        return;
      }
      ev.checkError = err instanceof Error ? err.message : String(err);
    }
    if (taskSession !== sessionId) {
      return;
    }
    renderEvents();
  });
  await checkQueue;
}

async function start() {
  // Bump first so any task currently sitting on the old checkQueue (between
  // its own awaits) sees the new session id and bails before touching the
  // about-to-be-recreated checkChar.
  sessionId++;
  mountChar?.destroy();
  checkChar?.destroy();
  events.length = 0;
  eventSeq = 0;
  checkChar = null;
  // Drop any tail of in-flight check() work from the previous session so
  // the new session's events are not serialized behind it.
  checkQueue = Promise.resolve();
  writerEl.innerHTML = "";
  renderEvents();
  setStatus("loading…");

  mountChar = char.create(TARGET_CHARACTER, {
    charDataLoader: cachedCharDataLoader,
  });
  mountChar.mount(writerEl, {
    size: 300,
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
