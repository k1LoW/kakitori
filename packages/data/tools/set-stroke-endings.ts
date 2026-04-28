import { createInterface, type Interface } from "node:readline/promises";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { StrokeEnding, KakitoriStrokeEndingsJson } from "../src/types.js";
import { suggestStrokeEnding } from "./suggest.js";
import { getCharSet } from "./charSets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "..", "data");
const require = createRequire(import.meta.url);

function loadCharData(char: string): { strokes: string[]; medians: number[][][] } {
  return require(`@k1low/hanzi-writer-data-jp/${char}.json`);
}

function loadExisting(char: string): KakitoriStrokeEndingsJson | null {
  const filePath = resolve(dataDir, `${char}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function saveData(data: KakitoriStrokeEndingsJson): void {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  const filePath = resolve(dataDir, `${data.character}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log(`Saved: ${filePath}`);
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
  const strokeCount = charData.strokes.length;

  console.log(`\n  ${char}  (${strokeCount} strokes)`);

  if (existing) {
    console.log("  (existing data found, press Enter to keep current value)");
  }

  const strokeEndings: StrokeEnding[] = [];

  for (let i = 0; i < strokeCount; i++) {
    const suggestion = suggestStrokeEnding(charData.medians[i]);
    const existingEnding = existing?.strokeEndings[i];
    const defaultType = existingEnding?.type ?? suggestion.type;
    const defaultLabel =
      defaultType === "tome" ? "t" : defaultType === "hane" ? "h" : "r";

    const answer = await rl.question(
      `  Stroke ${i + 1}/${strokeCount} [t]ome/[h]ane/ha[r]ai (${defaultLabel}): `,
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
      direction = suggestedDir ?? suggestStrokeEnding(charData.medians[i]).direction;
    }

    strokeEndings.push({ type, direction });
  }

  saveData({ character: char, strokeEndings });
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
