import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { KakitoriCharacterConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "..", "data");
const require = createRequire(import.meta.url);

const files = readdirSync(dataDir).filter((f) => f.endsWith(".json"));
const validTypes = ["tome", "hane", "harai"];

describe("data files", () => {
  it("has data files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(file, () => {
      const filePath = resolve(dataDir, file);
      const data: KakitoriCharacterConfig = JSON.parse(
        readFileSync(filePath, "utf-8"),
      );

      it("has valid character field", () => {
        expect(data.character).toBeTruthy();
        expect(typeof data.character).toBe("string");
      });

      it("character exists in hanzi-writer-data-jp", () => {
        expect(() => {
          require(`@k1low/hanzi-writer-data-jp/${data.character}.json`);
        }).not.toThrow();
      });

      const charData: { strokes: string[] } = require(
        `@k1low/hanzi-writer-data-jp/${data.character}.json`,
      );
      const dataStrokeCount = charData.strokes.length;

      if (data.strokeGroups) {
        it("strokeGroups covers all data strokes without duplicates", () => {
          const allIndices = data.strokeGroups!.flat();
          const uniqueIndices = new Set(allIndices);
          expect(allIndices.length).toBe(uniqueIndices.size);
          expect(uniqueIndices.size).toBe(dataStrokeCount);
          for (const idx of allIndices) {
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(dataStrokeCount);
          }
        });
      }

      if (data.strokeEndings) {
        const logicalStrokeCount = data.strokeGroups
          ? data.strokeGroups.length
          : dataStrokeCount;

        it("strokeEndings length matches logical stroke count", () => {
          expect(data.strokeEndings!.length).toBe(logicalStrokeCount);
        });

        it("strokeEndings have valid types", () => {
          for (const ending of data.strokeEndings!) {
            for (const t of ending.types ?? []) {
              expect(validTypes).toContain(t);
            }
          }
        });

        it("direction vectors are unit vectors", () => {
          for (const ending of data.strokeEndings!) {
            if (ending.direction != null) {
              const [dx, dy] = ending.direction;
              const mag = Math.sqrt(dx * dx + dy * dy);
              expect(Math.abs(mag - 1)).toBeLessThan(0.1);
            }
          }
        });
      }
    });
  }
});
