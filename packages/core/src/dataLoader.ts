const DEFAULT_CHAR_DATA_URL =
  "https://unpkg.com/@k1low/hanzi-writer-data-jp@latest";

const DEFAULT_CONFIG_URL =
  "https://unpkg.com/@k1low/kakitori-data@latest/data";

export function defaultCharDataLoader(
  char: string,
  onLoad: (data: { strokes: string[]; medians: number[][][] }) => void,
  onError: (err?: unknown) => void,
): void {
  fetch(`${DEFAULT_CHAR_DATA_URL}/${char}.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load data for "${char}"`);
      return res.json();
    })
    .then(onLoad)
    .catch(onError);
}

type StrokeEndingType = "tome" | "hane" | "harai";

export interface KakitoriCharacterConfig {
  character: string;
  strokeGroups?: number[][];
  strokeEndings?: Array<{
    types?: StrokeEndingType[];
    direction?: [number, number] | null;
  }>;
}

export function defaultConfigLoader(
  char: string,
): Promise<KakitoriCharacterConfig | null> {
  return fetch(`${DEFAULT_CONFIG_URL}/${char}.json`)
    .then((res) => {
      if (!res.ok) return null;
      return res.json();
    })
    .catch(() => null);
}
