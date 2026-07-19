#!/usr/bin/env node
// Registers kakitori.page question files (one question per JSON file) to a
// note via the import API. Strips the editor-only `$schema`, batches into the
// server's 100-item limit, and reports per-batch results. Dependency-free;
// Node 20+ (global fetch, Array.toSorted).
//
// Usage: node register.mjs [--key K] [--mode append|replace] [--base URL]
//                          [--dry-run] <file.json | dir> ...
//
//   --key K     import key (write credential + note identity). Falls back to
//               the KAKITORI_IMPORT_KEY env var. Never printed in full.
//   --mode M    append (default) or replace. replace wipes the note's existing
//               questions first; the skill confirms this with the user.
//   --base URL  API origin (default https://kakitori.page, or KAKITORI_BASE_URL).
//   --dry-run   build and describe the batches without POSTing anything.
//
// Exit code 0 = every batch registered.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const BATCH_SIZE = 100; // server caps questions[] at 100 items per request

const argv = process.argv.slice(2);
const opts = { key: undefined, mode: "append", base: undefined, dryRun: false };
const paths = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--key") {
    opts.key = argv[++i];
  } else if (a === "--mode") {
    opts.mode = argv[++i];
  } else if (a === "--base") {
    opts.base = argv[++i];
  } else if (a === "--dry-run") {
    opts.dryRun = true;
  } else if (a.startsWith("--")) {
    fail(`unknown flag "${a}"`);
  } else {
    paths.push(a);
  }
}

if (paths.length === 0) {
  fail("usage: node register.mjs [--key K] [--mode append|replace] [--base URL] [--dry-run] <file.json | dir> ...");
}
if (opts.mode !== "append" && opts.mode !== "replace") {
  fail(`--mode must be "append" or "replace" (got "${opts.mode}")`);
}

const key = opts.key ?? process.env.KAKITORI_IMPORT_KEY;
if (!key && !opts.dryRun) {
  fail("no import key: pass --key or set KAKITORI_IMPORT_KEY (a note's import key, not its play key)");
}
const base = (opts.base ?? process.env.KAKITORI_BASE_URL ?? "https://kakitori.page").replace(/\/+$/, "");

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}

// Show only the last 4 chars so a key never lands in logs or the terminal
// scrollback in full.
function maskKey(k) {
  if (!k) {
    return "(none)";
  }
  return k.length <= 4 ? "****" : `****${k.slice(-4)}`;
}

function collect(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch (e) {
    fail(`cannot read "${path}" (${e.code ?? e.message})`);
  }
  if (stat.isDirectory()) {
    return readdirSync(path)
      .filter((f) => f.endsWith(".json"))
      .toSorted()
      .map((f) => join(path, f));
  }
  return [path];
}

const files = paths.flatMap(collect);
if (files.length === 0) {
  fail("no .json files found");
}

// Parse, strip $schema, keep the source filename for error attribution.
const items = [];
for (const file of files) {
  let q;
  try {
    q = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(`${file}: invalid JSON (${e.message})`);
  }
  if (typeof q !== "object" || q === null || Array.isArray(q)) {
    fail(`${file}: not a question object`);
  }
  delete q.$schema; // server rejects it (additionalProperties: false)
  if (typeof q.word !== "string" || typeof q.reading !== "string") {
    fail(`${file}: missing word/reading (run validate.mjs first)`);
  }
  items.push({ file, question: q });
}

// Split into batches of 100.
const batches = [];
for (let i = 0; i < items.length; i += BATCH_SIZE) {
  batches.push(items.slice(i, i + BATCH_SIZE));
}

// replace means "the note should end up as exactly these questions". With more
// than one batch, only the first may carry replace; sending replace again would
// wipe the questions the earlier batch just added. So downgrade the rest to
// append.
function modeForBatch(index) {
  if (opts.mode === "replace" && index > 0) {
    return "append";
  }
  return opts.mode;
}

const endpoint = (k) => `${base}/api/v1/notes/${encodeURIComponent(k)}/questions`;

console.log(`target : ${endpoint(maskKey(key))}`);
console.log(`mode   : ${opts.mode}${opts.mode === "replace" && batches.length > 1 ? " (batch 1 replace, rest append)" : ""}`);
console.log(`items  : ${items.length} question(s) in ${batches.length} batch(es)`);

if (opts.dryRun) {
  console.log("\n--dry-run: nothing sent. Planned batches:");
  batches.forEach((b, i) => {
    console.log(`  batch ${i + 1}: ${b.length} item(s), mode=${modeForBatch(i)}  [${b[0].question.word} … ${b[b.length - 1].question.word}]`);
  });
  process.exit(0);
}

let failed = 0;
for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  const mode = modeForBatch(i);
  const body = JSON.stringify({ mode, questions: batch.map((b) => b.question) });
  let res, text;
  try {
    res = await fetch(endpoint(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    text = await res.text();
  } catch (e) {
    failed++;
    console.log(`✗ batch ${i + 1}/${batches.length} (${batch.length} items, ${mode}): network error ${e.message}`);
    continue;
  }
  if (res.ok) {
    console.log(`✓ batch ${i + 1}/${batches.length} (${batch.length} items, ${mode}) -> ${res.status}`);
  } else {
    failed++;
    let detail = text.slice(0, 500);
    try {
      const j = JSON.parse(text);
      if (j?.error) {
        detail = `${j.error.code ?? "error"}: ${j.error.message ?? ""}`;
      }
    } catch {}
    console.log(`✗ batch ${i + 1}/${batches.length} (${batch.length} items, ${mode}) -> ${res.status}  ${detail}`);
    console.log(`    files: ${batch.map((b) => basename(b.file)).join(", ")}`);
  }
}

console.log(`\n${batches.length - failed}/${batches.length} batch(es) registered`);
process.exit(failed === 0 ? 0 : 1);
