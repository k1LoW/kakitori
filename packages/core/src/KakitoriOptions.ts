import type { KakitoriStrokeData } from "./types.js";

export type KakitoriLogger = (msg: string) => void;

export interface KakitoriOptions {
  logger?: KakitoriLogger;
  /** Maps logical strokes to data stroke indices. e.g. [[0], [1], [2, 3]] merges data strokes 2 and 3 into one. */
  strokeGroups?: number[][];
  width?: number;
  height?: number;
  padding?: number;
  strokeColor?: string;
  outlineColor?: string;
  drawingColor?: string;
  highlightColor?: string;
  showOutline?: boolean;
  showCharacter?: boolean;
  renderer?: "svg" | "canvas";
  strokeAnimationSpeed?: number;
  delayBetweenStrokes?: number;
  strokeEndingStrictness?: number;
  leniency?: number;
  showHintAfterMisses?: number | false;
  highlightOnComplete?: boolean;
  charDataLoader?: (
    char: string,
    onLoad: (data: { strokes: string[]; medians: number[][][] }) => void,
    onError: (err?: unknown) => void,
  ) => void;
  onCorrectStroke?: (data: KakitoriStrokeData) => void;
  onStrokeEndingMistake?: (data: KakitoriStrokeData) => void;
  onMistake?: (data: KakitoriStrokeData) => void;
  onComplete?: (data: {
    character: string;
    totalMistakes: number;
    strokeEndingMistakes: number;
  }) => void;
}
