#!/usr/bin/env node
// Physically deletes one question on a kakitori.page note via
// DELETE /api/v1/notes/:key/questions/:qid. Used to fix a mis-registered
// question by removing the old row so the corrected version can be
// re-registered (word+reading uniqueness applies to paused rows too, so
// pause + re-register does not work). Dependency-free; Node 18+ (global fetch).
//
// Usage: node delete.mjs [--key K] [--force] [--base URL] [--dry-run] <qid>
//
//   --key K     import key (write credential + note identity). Falls back to
//               the KAKITORI_IMPORT_KEY env var. Never printed in full.
//   --force     pass ?force=true. Required when the question has any results
//               attached; the results row(s) and R2 payload(s) are then wiped
//               along with the question. Without --force, a question that has
//               even one result returns 409 question_has_results and nothing
//               is deleted.
//   --base URL  API origin (default https://kakitori.page, or KAKITORI_BASE_URL).
//   --dry-run   describe the target without actually calling DELETE.
//
// Exit code 0 = the question was deleted (or dry-run completed).
//              1 = server refused (invalid_key / not_found / has_results / …).

const argv = process.argv.slice(2);
const opts = { key: undefined, force: false, base: undefined, dryRun: false };
let qid;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--key" || a === "--base") {
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) {
      fail(`${a} requires a value`);
    }
    if (a === "--key") {
      opts.key = v;
    } else {
      opts.base = v;
    }
  } else if (a === "--force") {
    opts.force = true;
  } else if (a === "--dry-run") {
    opts.dryRun = true;
  } else if (a.startsWith("--")) {
    fail(`unknown flag "${a}"`);
  } else if (qid === undefined) {
    qid = a;
  } else {
    fail(`unexpected positional argument "${a}" (only one qid allowed)`);
  }
}

if (!qid) {
  fail("usage: node delete.mjs [--key K] [--force] [--base URL] [--dry-run] <qid>");
}

const key = opts.key ?? process.env.KAKITORI_IMPORT_KEY;
if (!key && !opts.dryRun) {
  fail("no import key: pass --key or set KAKITORI_IMPORT_KEY (delete needs an import key)");
}
const base = (opts.base ?? process.env.KAKITORI_BASE_URL ?? "https://kakitori.page").replace(/\/+$/, "");

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}

function maskKey(k) {
  if (!k) {
    return "(none)";
  }
  return k.length <= 4 ? "****" : `****${k.slice(-4)}`;
}

const endpoint = (k) =>
  `${base}/api/v1/notes/${encodeURIComponent(k)}/questions/${encodeURIComponent(qid)}${opts.force ? "?force=true" : ""}`;

console.log(`target : DELETE ${endpoint(maskKey(key ?? ""))}`);
console.log(`force  : ${opts.force ? "true (results will be wiped along with the question)" : "false (fails 409 if results exist)"}`);

if (opts.dryRun) {
  console.log("\n--dry-run: nothing sent.");
  process.exit(0);
}

let res, text;
try {
  res = await fetch(endpoint(key), { method: "DELETE" });
  text = await res.text();
} catch (e) {
  console.error(`✗ network error: ${e.message}`);
  process.exit(1);
}

let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text };
}

if (res.ok) {
  console.log(`✓ ${res.status}  deleted qid=${qid}  deletedResults=${body.deletedResults ?? 0}`);
  process.exit(0);
}

const code = body?.error?.code ?? "error";
const msg = body?.error?.message ?? "";
console.log(`✗ ${res.status} ${code}: ${msg}`);
if (code === "question_has_results" && body?.error?.details?.attempts !== undefined) {
  console.log(
    `    ${body.error.details.attempts} result(s) attached. Re-run with --force to delete both the question and those results.`,
  );
}
process.exit(1);
