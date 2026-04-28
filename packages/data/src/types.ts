export type StrokeEndingType = "tome" | "hane" | "harai";

export interface StrokeEnding {
  /** Acceptable stroke ending types. First is preferred, any match is OK. */
  type: StrokeEndingType | StrokeEndingType[];
  direction: [number, number] | null;
}

export interface KakitoriCharacterConfig {
  character: string;
  /** Maps logical strokes to data stroke indices. e.g. [[0], [1], [2, 3]] means data strokes 2 and 3 form one logical stroke. */
  strokeGroups?: number[][];
  strokeEndings?: StrokeEnding[];
}
