const DEFAULT_CHAR_DATA_URL =
  "https://unpkg.com/@k1low/hanzi-writer-data-jp@latest";

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
