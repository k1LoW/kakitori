import { createInterface, type Interface } from "node:readline/promises";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { StrokeEnding, KakitoriCharacterConfig } from "../src/types.js";
import { suggestStrokeEnding } from "./suggest.js";
import { getCharSet } from "./charSets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "..", "data");
const require = createRequire(import.meta.url);

function loadCharData(char: string): { strokes: string[]; medians: number[][][] } {
  return require(`@k1low/hanzi-writer-data-jp/${char}.json`);
}

function loadExisting(char: string): KakitoriCharacterConfig | null {
  const filePath = resolve(dataDir, `${char}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function saveData(data: KakitoriCharacterConfig): void {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  const filePath = resolve(dataDir, `${data.character}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log(`Saved: ${filePath}`);
}

/**
 * Parse strokeGroups input.
 * Format: "0,1,2+3" means [[0],[1],[2,3]]
 * Each group separated by comma, sub-strokes within a group joined by +.
 */
function parseStrokeGroups(input: string, dataStrokeCount: number): number[][] {
  if (!input.trim()) {
    // Default: each data stroke is its own group
    return Array.from({ length: dataStrokeCount }, (_, i) => [i]);
  }
  return input.split(",").map((g) =>
    g.split("+").map((s) => parseInt(s.trim(), 10)),
  );
}

async function annotateChar(
  rl: Interface,
  char: string,
): Promise<void> {
  let charData: { strokes: string[]; medians: number[][][] };
  try {
    charData = loadCharData(char);
  } catch {
    console.error(`Character data not found for: ${char}`);
    return;
  }

  const existing = loadExisting(char);
  const dataStrokeCount = charData.strokes.length;

  console.log(`\n  ${char}  (${dataStrokeCount} data strokes)`);

  if (existing) {
    console.log("  (existing data found, press Enter to keep current value)");
  }

  // Step 1: Configure strokeGroups
  const defaultGroups = existing?.strokeGroups
    ?? Array.from({ length: dataStrokeCount }, (_, i) => [i]);
  const defaultGroupsStr = defaultGroups
    .map((g) => g.join("+"))
    .join(",");

  console.log(`  strokeGroups format: 0,1,2+3 means strokes 2 and 3 are merged`);
  const groupsInput = await rl.question(
    `  strokeGroups (${defaultGroupsStr}): `,
  );
  const strokeGroups = groupsInput.trim()
    ? parseStrokeGroups(groupsInput, dataStrokeCount)
    : defaultGroups;

  const logicalStrokeCount = strokeGroups.length;
  const needsGroups = logicalStrokeCount !== dataStrokeCount;

  console.log(
    `  ${logicalStrokeCount} logical strokes${needsGroups ? ` (merged from ${dataStrokeCount})` : ""}`,
  );

  // Step 2: Set stroke endings per logical stroke
  const strokeEndings: StrokeEnding[] = [];

  for (let i = 0; i < logicalStrokeCount; i++) {
    const group = strokeGroups[i];
    const lastDataIdx = group[group.length - 1];
    const suggestion = suggestStrokeEnding(charData.medians[lastDataIdx]);
    const existingEnding = existing?.strokeEndings?.[i];
    const defaultType = existingEnding?.type ?? suggestion.type;
    const defaultLabel =
      defaultType === "tome" ? "t" : defaultType === "hane" ? "h" : "r";

    const groupLabel = group.length > 1 ? ` [data: ${group.join("+")}]` : "";
    const answer = await rl.question(
      `  Stroke ${i + 1}/${logicalStrokeCount}${groupLabel} [t]ome/[h]ane/ha[r]ai (${defaultLabel}): `,
    );

    let type: StrokeEnding["type"];
    const input = answer.trim().toLowerCase();
    if (input === "" || input === defaultLabel) {
      type = defaultType;
    } else if (input === "t") {
      type = "tome";
    } else if (input === "h") {
      type = "hane";
    } else if (input === "r") {
      type = "harai";
    } else {
      console.log(`  Invalid input "${input}", using default: ${defaultType}`);
      type = defaultType;
    }

    let direction: [number, number] | null = null;
    if (type === "hane" || type === "harai") {
      const suggestedDir =
        existingEnding?.direction ?? suggestion.direction;
      direction = suggestedDir ?? suggestStrokeEnding(charData.medians[lastDataIdx]).direction;
    }

    strokeEndings.push({ type, direction });
  }

  const result: KakitoriCharacterConfig = { character: char, strokeEndings };
  if (needsGroups) {
    result.strokeGroups = strokeGroups;
  }
  saveData(result);
}

async function main() {
  const args = process.argv.slice(2);
  let chars: string[] = [];

  const setIndex = args.indexOf("--set");
  if (setIndex !== -1 && args[setIndex + 1]) {
    chars = getCharSet(args[setIndex + 1]);
  } else if (args.length > 0 && !args[0].startsWith("-")) {
    chars = [...args[0]];
  } else {
    console.error("Usage:");
    console.error("  tsx tools/set-stroke-endings.ts <char>");
    console.error("  tsx tools/set-stroke-endings.ts --set <name>");
    console.error("Available sets: numbers, grade1, grade2");
    process.exit(1);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    for (const char of chars) {
      await annotateChar(rl, char);
    }
  } finally {
    rl.close();
  }
}

main();
