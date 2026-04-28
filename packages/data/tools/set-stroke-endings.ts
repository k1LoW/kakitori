import { createInterface, type Interface } from "node:readline/promises";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { StrokeEnding, StrokeEndingType, KakitoriCharacterConfig } from "../src/types.js";
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
  console.log(`\n  Saved: ${filePath}`);
}

function typeToLabel(types: StrokeEndingType[]): string {
  return types.map((t) => (t === "tome" ? "t" : t === "hane" ? "h" : "r")).join("+");
}

function formatStrokeEnding(ending: StrokeEnding): string {
  const types = ending.types ?? [];
  if (types.length === 0) return "(skip)";
  const dir = ending.direction
    ? ` dir=[${ending.direction[0]}, ${ending.direction[1]}]`
    : "";
  return `${types.join("+")}${dir}`;
}

function formatGroups(groups: number[][]): string {
  return groups.map((g) => g.join("+")).join(",");
}

function parseStrokeGroups(input: string, dataStrokeCount: number): number[][] {
  if (!input.trim()) {
    return Array.from({ length: dataStrokeCount }, (_, i) => [i]);
  }
  return input.split(",").map((g) =>
    g.split("+").map((s) => parseInt(s.trim(), 10)),
  );
}

function showExisting(existing: KakitoriCharacterConfig, dataStrokeCount: number): void {
  console.log("  --- current config ---");
  const groups = existing.strokeGroups
    ?? Array.from({ length: dataStrokeCount }, (_, i) => [i]);
  const needsGroups = groups.length !== dataStrokeCount;
  if (needsGroups) {
    console.log(`  strokeGroups: ${formatGroups(groups)} (${dataStrokeCount} data -> ${groups.length} logical)`);
  }
  if (existing.strokeEndings) {
    for (let i = 0; i < existing.strokeEndings.length; i++) {
      const groupLabel = needsGroups && groups[i].length > 1
        ? ` [data: ${groups[i].join("+")}]`
        : "";
      console.log(`  ${i + 1}: ${formatStrokeEnding(existing.strokeEndings[i])}${groupLabel}`);
    }
  }
  console.log("  ---");
  console.log("  Press Enter to keep current value, or type to overwrite.");
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
    showExisting(existing, dataStrokeCount);
  }

  // Step 1: Configure strokeGroups
  const defaultGroups = existing?.strokeGroups
    ?? Array.from({ length: dataStrokeCount }, (_, i) => [i]);
  const defaultGroupsStr = formatGroups(defaultGroups);

  const groupsInput = await rl.question(
    `  strokeGroups [${defaultGroupsStr}]: `,
  );
  const strokeGroups = groupsInput.trim()
    ? parseStrokeGroups(groupsInput, dataStrokeCount)
    : defaultGroups;

  const logicalStrokeCount = strokeGroups.length;
  const needsGroups = logicalStrokeCount !== dataStrokeCount;

  if (needsGroups) {
    console.log(`  -> ${logicalStrokeCount} logical strokes (merged from ${dataStrokeCount})`);
  }

  // Step 2: Set stroke endings per logical stroke
  const strokeEndings: StrokeEnding[] = [];

  for (let i = 0; i < logicalStrokeCount; i++) {
    const group = strokeGroups[i];
    const lastDataIdx = group[group.length - 1];
    const suggestion = suggestStrokeEnding(charData.medians[lastDataIdx]);
    const existingEnding = existing?.strokeEndings?.[i];
    const existingTypes = existingEnding?.types ?? [];
    const defaultTypes = existingTypes.length > 0 ? existingTypes : [suggestion.type];
    const defaultLabel = typeToLabel(defaultTypes);

    const groupLabel = group.length > 1 ? ` [data: ${group.join("+")}]` : "";
    const currentLabel = existingEnding
      ? ` (current: ${formatStrokeEnding(existingEnding)})`
      : "";
    const answer = await rl.question(
      `  Stroke ${i + 1}/${logicalStrokeCount}${groupLabel} [t]ome/[h]ane/ha[r]ai (use + for multiple, e.g. t+r) [${defaultLabel}]${currentLabel}: `,
    );

    const input = answer.trim().toLowerCase();
    let types: StrokeEndingType[];
    if (input === "") {
      types = defaultTypes;
    } else if (input === "-") {
      // Explicit skip
      types = [];
    } else {
      const parts = input.split("+").map((s) => s.trim());
      const parsed = parts.map((p) => {
        if (p === "t") return "tome" as const;
        if (p === "h") return "hane" as const;
        if (p === "r") return "harai" as const;
        return null;
      });
      const valid = parsed.filter((p) => p !== null);
      if (valid.length === 0) {
        console.log(`  Invalid input "${input}", using default`);
        types = defaultTypes;
      } else {
        types = valid;
      }
    }

    const ending: StrokeEnding = {};
    if (types.length > 0) {
      ending.types = types;
      if (types.includes("hane") || types.includes("harai")) {
        const suggestedDir =
          existingEnding?.direction ?? suggestion.direction;
        ending.direction = suggestedDir ?? suggestStrokeEnding(charData.medians[lastDataIdx]).direction;
      }
    }

    strokeEndings.push(ending);
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
