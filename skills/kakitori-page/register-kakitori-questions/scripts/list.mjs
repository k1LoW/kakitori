#!/usr/bin/env node
// Lists questions on a kakitori.page note via GET /api/v1/notes/:key/questions.
// Purpose: find the qid of a mis-registered question before deleting it, or
// audit paused questions the import script may have left behind. `paused` /
// `all` require an import key (server returns 403 invalid_key otherwise).
// Dependency-free; Node 18+ (global fetch).
//
// Usage: node list.mjs [--key K] [--status active|paused|all]
//                      [--chars C] [--sort S] [--limit N]
//                      [--base URL] [--format table|json]
//
//   --key K       play or import key. Falls back to KAKITORI_IMPORT_KEY, then
//                 KAKITORI_PLAY_KEY. `paused` / `all` require an import key.
//   --status S    active (default) / paused / all.
//   --chars C     filter to questions whose `word` contains any of these chars.
//   --sort S      created (default) / weakest / least_attempted / random.
//   --limit N     rows per page (1..200, default 100).
//   --base URL    API origin (default https://kakitori.page, or KAKITORI_BASE_URL).
//   --format F    table (default, one row per question) or json (every page's
//                 questions merged into a single flat array; not the raw
//                 { questions, nextCursor } response shape).
//
// Exit code 0 = at least one page fetched successfully.

const argv = process.argv.slice(2);
const opts = {
  key: undefined,
  status: "active",
  chars: undefined,
  sort: "created",
  limit: "100",
  base: undefined,
  format: "table",
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (
    a === "--key" ||
    a === "--status" ||
    a === "--chars" ||
    a === "--sort" ||
    a === "--limit" ||
    a === "--base" ||
    a === "--format"
  ) {
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) {
      fail(`${a} requires a value`);
    }
    opts[a.slice(2)] = v;
  } else if (a.startsWith("--")) {
    fail(`unknown flag "${a}"`);
  } else {
    fail(`unexpected positional argument "${a}"`);
  }
}

if (!["active", "paused", "all"].includes(opts.status)) {
  fail(`--status must be one of active | paused | all (got "${opts.status}")`);
}
// Keep the accepted set in sync with SORT_EXPR in kakitori.page's
// src/api/v1.ts. Client-side validation catches typos before they turn into
// opaque 400s from the server, and keeps the CLI honest about what it
// documents in its own --help.
if (!["created", "weakest", "least_attempted", "random"].includes(opts.sort)) {
  fail(`--sort must be one of created | weakest | least_attempted | random (got "${opts.sort}")`);
}
if (!["table", "json"].includes(opts.format)) {
  fail(`--format must be table or json (got "${opts.format}")`);
}
const limit = Number(opts.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
  fail(`--limit must be an integer in 1..200 (got "${opts.limit}")`);
}

const key = opts.key ?? process.env.KAKITORI_IMPORT_KEY ?? process.env.KAKITORI_PLAY_KEY;
if (!key) {
  fail("no key: pass --key or set KAKITORI_IMPORT_KEY (paused / all need import key)");
}
const base = (opts.base ?? process.env.KAKITORI_BASE_URL ?? "https://kakitori.page").replace(/\/+$/, "");

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}

function maskKey(k) {
  return k.length <= 4 ? "****" : `****${k.slice(-4)}`;
}

const params = new URLSearchParams();
params.set("status", opts.status);
params.set("sort", opts.sort);
params.set("limit", String(limit));
if (opts.chars) {
  params.set("chars", opts.chars);
}

const endpoint = `${base}/api/v1/notes/${encodeURIComponent(key)}/questions`;
console.log(`target : ${base}/api/v1/notes/${maskKey(key)}/questions`);
console.log(`query  : status=${opts.status} sort=${opts.sort} limit=${limit}${opts.chars ? ` chars=${opts.chars}` : ""}`);
console.log("");

let cursor;
let page = 0;
let total = 0;
const allRows = [];
while (true) {
  const q = new URLSearchParams(params);
  if (cursor) {
    q.set("cursor", cursor);
  }
  let res, text;
  try {
    res = await fetch(`${endpoint}?${q.toString()}`);
    text = await res.text();
  } catch (e) {
    console.error(`network error: ${e.message}`);
    process.exit(1);
  }
  if (!res.ok) {
    let detail = text.slice(0, 500);
    try {
      const j = JSON.parse(text);
      if (j?.error) {
        detail = `${j.error.code ?? "error"}: ${j.error.message ?? ""}`;
      }
    } catch {}
    console.error(`✗ ${res.status}  ${detail}`);
    process.exit(1);
  }
  // A 200 from a proxy / CDN can still carry an HTML error page; guard
  // JSON.parse so that case surfaces as a clear error line rather than an
  // unhandled SyntaxError with a stack trace.
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    console.error(`✗ ${res.status}: response was not JSON (${e.message}). First 200 chars: ${text.slice(0, 200)}`);
    process.exit(1);
  }
  page++;
  const rows = body.questions ?? [];
  total += rows.length;
  allRows.push(...rows);
  if (opts.format === "table") {
    printTable(rows, page === 1);
  }
  cursor = body.nextCursor;
  if (!cursor) {
    break;
  }
}

if (opts.format === "json") {
  console.log(JSON.stringify(allRows, null, 2));
}
console.log(`\n${total} question(s) listed`);

function printTable(rows, isFirst) {
  if (isFirst) {
    console.log(
      `${"id".padEnd(36)}  ${"status".padEnd(7)}  ${"attempts".padStart(8)}  word / reading`,
    );
    console.log("-".repeat(36 + 2 + 7 + 2 + 8 + 2 + 20));
  }
  for (const r of rows) {
    const attempts = r.stats?.attempts ?? 0;
    console.log(
      `${r.id}  ${(r.status ?? "?").padEnd(7)}  ${String(attempts).padStart(8)}  ${r.word} (${r.reading})`,
    );
  }
}
