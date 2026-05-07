import { describe, it, expect } from "vitest";
import { runWithJudgeLock, type JudgeCharEntry } from "./charCache.js";
import type { Char } from "../char.js";

// `JudgeCharEntry` requires a real `Char` for everyday use, but
// `runWithJudgeLock` only ever touches `judgeLock`, so a partial fixture
// is enough to drive the mutex contract in isolation.
function fakeEntry(): JudgeCharEntry {
  return {
    char: {} as Char,
    dataStrokeCount: 0,
    logicalStrokeCount: 0,
    normalizeTarget: { centerX: 0, centerY: 0, longerSide: 1 },
    judgeLock: Promise.resolve(),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runWithJudgeLock", () => {
  it("serializes overlapping callers against the same entry", async () => {
    const entry = fakeEntry();
    const order: string[] = [];
    const first = deferred<void>();
    const second = deferred<void>();

    const a = runWithJudgeLock(entry, async () => {
      order.push("a:start");
      await first.promise;
      order.push("a:end");
    });
    const b = runWithJudgeLock(entry, async () => {
      order.push("b:start");
      await second.promise;
      order.push("b:end");
    });

    // b must wait for a to finish before its body runs at all.
    await Promise.resolve();
    expect(order).toEqual(["a:start"]);

    first.resolve();
    await a;
    expect(order).toEqual(["a:start", "a:end", "b:start"]);

    second.resolve();
    await b;
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("releases the lock after fn rejects so the next caller still runs", async () => {
    const entry = fakeEntry();
    const reason = new Error("boom");
    await expect(
      runWithJudgeLock(entry, async () => {
        throw reason;
      }),
    ).rejects.toBe(reason);

    let ran = false;
    await runWithJudgeLock(entry, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("does not block callers on different entries", async () => {
    const entryA = fakeEntry();
    const entryB = fakeEntry();
    const blocker = deferred<void>();

    const longRunningA = runWithJudgeLock(entryA, async () => {
      await blocker.promise;
    });

    let bRan = false;
    await runWithJudgeLock(entryB, async () => {
      bRan = true;
    });
    expect(bRan).toBe(true);

    blocker.resolve();
    await longRunningA;
  });
});
