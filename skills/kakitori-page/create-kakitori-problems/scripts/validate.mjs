#!/usr/bin/env node
// Validates kakitori.page problem files (one problem per JSON file) against
// the published schema constraints and the server-side integrity rules, so
// registration succeeds on the first try. Dependency-free; Node 18+.
//
// Usage: node validate.mjs [--offline] <file.json | dir> ...
//   --offline  skip the stroke-data existence check (needs network)
//
// Exit code 0 = all files pass.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const SCHEMA_URL = "https://kakitori.page/schemas/problem.json";
const CHAR_DATA_BASE_URL = "https://unpkg.com/@k1low/hanzi-writer-data-jp@latest";

// Matches the server: hiragana, katakana and the long vowel mark count as
// kana (kana segments carry no reading; katakana contributes its hiragana
// form to the reading-concatenation check).
const KANA_RE = /^[ぁ-ゖァ-ヶー]+$/u;
const READING_RE = /^[ぁ-ゖー]+$/u;

const args = process.argv.slice(2);
const offline = args.includes("--offline");
const paths = args.filter((a) => a !== "--offline");
if (paths.length === 0) {
  console.error("usage: node validate.mjs [--offline] <file.json | dir> ...");
  process.exit(2);
}

const files = paths.flatMap(collect);
if (files.length === 0) {
  console.error("no .json files found");
  process.exit(2);
}

function collect(path) {
  if (statSync(path).isDirectory()) {
    return readdirSync(path)
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(path, f));
  }
  return [path];
}

const cp = (s) => [...s]; // code points
const toHiragana = (s) =>
  s.replace(/[ァ-ヶ]/gu, (ch) => String.fromCodePoint(ch.codePointAt(0) - 0x60));

function validate(file) {
  const errors = [];
  const warnings = [];
  let problem;
  try {
    problem = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { errors: [`invalid JSON: ${e.message}`], warnings, chars: [] };
  }

  const allowed = new Set(["$schema", "word", "reading", "segments", "sentences"]);
  for (const key of Object.keys(problem)) {
    if (!allowed.has(key)) {
      errors.push(`unknown field "${key}"`);
    }
  }
  if (problem.$schema === undefined) {
    warnings.push(`missing "$schema": "${SCHEMA_URL}" (editor validation will not work)`);
  } else if (problem.$schema !== SCHEMA_URL) {
    errors.push(`$schema must be "${SCHEMA_URL}"`);
  }

  const { word, reading, segments, sentences } = problem;

  if (typeof word !== "string" || cp(word).length < 1 || cp(word).length > 16) {
    errors.push("word must be a string of 1..16 characters");
  }
  if (typeof reading !== "string" || cp(reading).length < 1 || cp(reading).length > 32) {
    errors.push("reading must be a string of 1..32 characters");
  } else if (!READING_RE.test(reading)) {
    errors.push("reading must be hiragana (and ー) only");
  }

  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 16) {
    errors.push("segments must be an array of 1..16 items (write them explicitly)");
  } else if (typeof word === "string") {
    for (const [i, seg] of segments.entries()) {
      if (typeof seg !== "object" || seg === null || Array.isArray(seg)) {
        errors.push(`segments[${i}] must be an object`);
        continue;
      }
      for (const key of Object.keys(seg)) {
        if (key !== "text" && key !== "reading") {
          errors.push(`segments[${i}] has unknown field "${key}"`);
        }
      }
      if (typeof seg.text !== "string" || cp(seg.text).length !== 1) {
        errors.push(`segments[${i}].text must be exactly one character`);
      }
      if (seg.reading !== undefined) {
        if (
          typeof seg.reading !== "string" ||
          cp(seg.reading).length < 1 ||
          cp(seg.reading).length > 8 ||
          !READING_RE.test(seg.reading)
        ) {
          errors.push(`segments[${i}].reading must be 1..8 hiragana characters`);
        }
        // Server integrity rule 3.
        if (typeof seg.text === "string" && KANA_RE.test(seg.text)) {
          errors.push(`segments[${i}] "${seg.text}" is kana and must not have a reading`);
        }
      }
    }

    // Server integrity rule 1: joined texts == word.
    const joined = segments.map((s) => s?.text ?? "").join("");
    if (joined !== word) {
      errors.push(`segments join to "${joined}" but word is "${word}"`);
    }

    // Server integrity rule 2: reading contribution concatenation. Skipped
    // when any non-kana segment has no reading (jukujikun etc.).
    let checkable = true;
    const contributions = [];
    for (const seg of segments) {
      if (typeof seg?.text !== "string") { checkable = false; break; }
      if (seg.reading !== undefined) {
        contributions.push(seg.reading);
      } else if (KANA_RE.test(seg.text)) {
        contributions.push(toHiragana(seg.text));
      } else { checkable = false; break; }
    }
    if (checkable && typeof reading === "string" && contributions.join("") !== reading) {
      errors.push(
        `segment readings join to "${contributions.join("")}" but reading is "${reading}" ` +
          `(use surface forms: 学校の学 is がっ, not がく)`,
      );
    }
    if (!checkable && Array.isArray(segments) && segments.some((s) => s?.reading !== undefined)) {
      warnings.push(
        "some non-kana segments have readings and some do not: the reading check is skipped " +
          "and games cannot render per-char furigana. Intentional only for jukujikun-adjacent cases",
      );
    }
  }

  if (sentences !== undefined) {
    if (!Array.isArray(sentences) || sentences.length > 8) {
      errors.push("sentences must be an array of at most 8 items");
    } else {
      const seen = new Set();
      for (const [i, s] of sentences.entries()) {
        if (typeof s !== "string" || cp(s).length < 1 || cp(s).length > 40) {
          errors.push(`sentences[${i}] must be a string of 1..40 characters`);
          continue;
        }
        if (typeof word === "string" && !s.includes(word)) {
          errors.push(`sentences[${i}] does not contain the word "${word}" as-is`);
        }
        if (seen.has(s)) {
          errors.push(`sentences[${i}] duplicates another sentence`);
        }
        seen.add(s);
      }
    }
  }

  // Filename convention: <word>-<reading>.json (unique because word+reading
  // is the uniqueness key within a note).
  if (typeof word === "string" && typeof reading === "string") {
    const expected = `${word}-${reading}.json`;
    if (basename(file) !== expected) {
      errors.push(`filename should be "${expected}"`);
    }
  }

  return { errors, warnings, chars: typeof word === "string" ? cp(word) : [] };
}

// Stroke-data existence (server integrity rule 4): every word char must
// exist in @k1low/hanzi-writer-data-jp or registration fails with 422.
const charCache = new Map();
async function charExists(char) {
  if (charCache.has(char)) {
    return charCache.get(char);
  }
  const res = await fetch(`${CHAR_DATA_BASE_URL}/${encodeURIComponent(char)}.json`, {
    method: "HEAD",
  });
  const ok = res.ok;
  charCache.set(char, ok);
  return ok;
}

let failed = 0;
for (const file of files) {
  const { errors, warnings, chars } = validate(file);
  if (!offline && errors.length === 0) {
    for (const char of new Set(chars)) {
      try {
        if (!(await charExists(char))) {
          errors.push(`no stroke data for "${char}" (cannot be used in a problem)`);
        }
      } catch {
        warnings.push(`stroke-data check unreachable for "${char}" (network?); use --offline to silence`);
      }
    }
  }
  if (errors.length > 0) {
    failed++;
    console.log(`✗ ${file}`);
    for (const e of errors) {
      console.log(`    error: ${e}`);
    }
  } else {
    console.log(`✓ ${file}`);
  }
  for (const w of warnings) {
    console.log(`    warning: ${w}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} passed`);
process.exit(failed === 0 ? 0 : 1);
