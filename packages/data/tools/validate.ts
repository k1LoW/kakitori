import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { KakitoriStrokeEndingsJson } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "..", "data");
const require = createRequire(import.meta.url);

function validate(): void {
  let files: string[];
  try {
    files = readdirSync(dataDir).filter((f) => f.endsWith(".json"));
  } catch {
    console.log("No data files found.");
    return;
  }

  let errors = 0;
  let valid = 0;

  for (const file of files) {
    const filePath = resolve(dataDir, file);
    const prefix = `  ${file}:`;

    let data: KakitoriStrokeEndingsJson;
    try {
      data = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (e) {
      console.error(`${prefix} Invalid JSON`);
      errors++;
      continue;
    }

    if (!data.character || typeof data.character !== "string") {
      console.error(`${prefix} Missing or invalid "character" field`);
      errors++;
      continue;
    }

    if (!Array.isArray(data.strokeEndings)) {
      console.error(`${prefix} Missing or invalid "strokeEndings" array`);
      errors++;
      continue;
    }

    // Validate against hanzi-writer-data-jp stroke count
    let charData: { strokes: string[] };
    try {
      charData = require(`@k1low/hanzi-writer-data-jp/${data.character}.json`);
    } catch {
      console.error(
        `${prefix} Character "${data.character}" not found in @k1low/hanzi-writer-data-jp`,
      );
      errors++;
      continue;
    }

    if (data.strokeEndings.length !== charData.strokes.length) {
      console.error(
        `${prefix} strokeEndings length (${data.strokeEndings.length}) !== strokes length (${charData.strokes.length})`,
      );
      errors++;
      continue;
    }

    let strokeErrors = false;
    for (let i = 0; i < data.strokeEndings.length; i++) {
      const ending = data.strokeEndings[i];
      if (!["tome", "hane", "harai"].includes(ending.type)) {
        console.error(
          `${prefix} Stroke ${i + 1}: invalid type "${ending.type}"`,
        );
        strokeErrors = true;
      }
      if (
        (ending.type === "hane" || ending.type === "harai") &&
        ending.direction != null
      ) {
        const [dx, dy] = ending.direction;
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs(mag - 1) > 0.1) {
          console.error(
            `${prefix} Stroke ${i + 1}: direction is not a unit vector (magnitude: ${mag.toFixed(2)})`,
          );
          strokeErrors = true;
        }
      }
    }

    if (strokeErrors) {
      errors++;
    } else {
      valid++;
    }
  }

  console.log(`\nValidation: ${valid} valid, ${errors} errors, ${files.length} total`);
  if (errors > 0) {
    process.exit(1);
  }
}

validate();
