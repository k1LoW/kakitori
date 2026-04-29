import type { KakitoriStrokeData } from "./types.js";
import type { KakitoriCharacterConfig } from "./dataLoader.js";

export type KakitoriLogger = (msg: string) => void;
export type ConfigLoaderFn = (char: string) => Promise<KakitoriCharacterConfig | null>;

export interface KakitoriOptions {
  logger?: KakitoriLogger;
  /** Custom config loader. Defaults to loading from unpkg @k1low/kakitori-data. Set to null to disable auto-loading. */
  configLoader?: ConfigLoaderFn | null;
  /** Maps logical strokes to data stroke indices. Overrides config from configLoader. */
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
