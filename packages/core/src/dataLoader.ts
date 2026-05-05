import type { StrokeEndingType } from "./types.js";

const DEFAULT_CHAR_DATA_URL =
  "https://unpkg.com/@k1low/hanzi-writer-data-jp@latest";

const DEFAULT_CONFIG_URL =
  "https://unpkg.com/@k1low/kakitori-data@latest/data";

export function defaultCharDataLoader(
  char: string,
  onLoad: (data: { strokes: string[]; medians: number[][][] }) => void,
  onError: (err?: unknown) => void,
): void {
  fetch(`${DEFAULT_CHAR_DATA_URL}/${encodeURIComponent(char)}.json`)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`Failed to load data for "${char}"`);
      }
      return res.json();
    })
    .then(onLoad)
    .catch(onError);
}

export interface KakitoriCharacterConfig {
  character: string;
  strokeGroups?: number[][];
  strokeEndings?: Array<{
    types?: StrokeEndingType[];
    direction?: [number, number] | null;
  }>;
}

const CONFIG_TIMEOUT_MS = 3000;

export function defaultConfigLoader(
  char: string,
): Promise<KakitoriCharacterConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
  return fetch(`${DEFAULT_CONFIG_URL}/${encodeURIComponent(char)}.json`, {
    signal: controller.signal,
  })
    .then((res) => {
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(
          `Failed to load config for "${char}" (HTTP ${res.status})`,
        );
      }
      return res.json();
    })
    .catch((err: unknown) => {
      if (
        err != null &&
        typeof err === "object" &&
        (err as { name?: string }).name === "AbortError"
      ) {
        return null;
      }
      throw err;
    })
    .finally(() => clearTimeout(timer));
}
