export type StrokeEndingType = "tome" | "hane" | "harai";

export interface StrokeEnding {
  /** Acceptable stroke ending types. Empty or omitted = skip judgment. */
  types?: StrokeEndingType[];
  direction?: [number, number] | null;
}

export interface KakitoriCharacterConfig {
  character: string;
  /** Maps logical strokes to data stroke indices. e.g. [[0], [1], [2, 3]] means data strokes 2 and 3 form one logical stroke. */
  strokeGroups?: number[][];
  /** Per-stroke ending config. {} entries skip judgment for that stroke. */
  strokeEndings?: StrokeEnding[];
}
