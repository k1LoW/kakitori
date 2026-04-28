export type StrokeEndingType = "tome" | "hane" | "harai";

export interface StrokeEnding {
  type: StrokeEndingType;
  direction: [number, number] | null;
}

export interface KakitoriStrokeEndingsJson {
  character: string;
  strokeEndings: StrokeEnding[];
}
