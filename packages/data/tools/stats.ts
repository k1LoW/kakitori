import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { charSets } from "./charSets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "..", "data");

function stats(): void {
  let existingFiles: Set<string>;
  try {
    existingFiles = new Set(
      readdirSync(dataDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", "")),
    );
  } catch {
    existingFiles = new Set();
  }

  console.log("Stroke endings data progress:\n");

  let totalChars = 0;
  let totalDone = 0;

  for (const [name, chars] of Object.entries(charSets)) {
    const uniqueChars = [...new Set(chars)];
    const done = uniqueChars.filter((c) => existingFiles.has(c)).length;
    const total = uniqueChars.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
    console.log(
      `  ${name.padEnd(12)} ${bar} ${String(done).padStart(4)}/${String(total).padStart(4)} (${String(pct).padStart(3)}%)`,
    );
    totalChars += total;
    totalDone += done;
  }

  const totalPct =
    totalChars > 0 ? Math.round((totalDone / totalChars) * 100) : 0;
  console.log(
    `\n  ${"Total".padEnd(12)} ${" ".repeat(20)} ${String(totalDone).padStart(4)}/${String(totalChars).padStart(4)} (${String(totalPct).padStart(3)}%)`,
  );
}

stats();
