import type { CharStrokeData } from "./types.js";
import type { CharacterConfig } from "./dataLoader.js";

export type CharLogger = (msg: string) => void;
export type ConfigLoaderFn = (char: string) => Promise<CharacterConfig | null>;

export type CharDataLoaderFn = (
  char: string,
  onLoad: (data: { strokes: string[]; medians: number[][][] }) => void,
  onError: (err?: unknown) => void,
) => void;

export interface GridOptions {
  color?: string;
  dashArray?: string;
  width?: number;
}

export interface RenderOptions {
  size?: number;
  padding?: number;
  strokeColor?: string;
  showGrid?: boolean | GridOptions;
  charDataLoader?: CharDataLoaderFn;
  onClick?: (data: { character: string }) => void;
}

export interface CharOptions {
  logger?: CharLogger;
  /** Custom config loader. Defaults to loading from unpkg @k1low/kakitori-data. Set to null to disable auto-loading. */
  configLoader?: ConfigLoaderFn | null;
  /** Maps logical strokes to data stroke indices. Overrides config from configLoader. */
  strokeGroups?: number[][];
  size?: number;
  padding?: number;
  strokeColor?: string;
  outlineColor?: string;
  drawingColor?: string;
  drawingWidth?: number;
  highlightColor?: string;
  showGrid?: boolean | GridOptions;
  showOutline?: boolean;
  showCharacter?: boolean;
  strokeAnimationSpeed?: number;
  delayBetweenStrokes?: number;
  strokeEndingStrictness?: number;
  /**
   * When true, a stroke whose ending (tome/hane/harai) does not match the
   * expected types is rejected as a miss: the stroke is not advanced and the
   * user must redraw it. `onStrokeEndingMistake` and `onMistake` both fire.
   * Default: false.
   */
  strokeEndingAsMiss?: boolean;
  leniency?: number;
  showHintAfterMisses?: number | false;
  highlightOnComplete?: boolean;
  charDataLoader?: CharDataLoaderFn;
  onCorrectStroke?: (data: CharStrokeData) => void;
  onStrokeEndingMistake?: (data: CharStrokeData) => void;
  onMistake?: (data: CharStrokeData) => void;
  onComplete?: (data: {
    character: string;
    totalMistakes: number;
    strokeEndingMistakes: number;
  }) => void;
  onClick?: (data: {
    character: string;
    strokeIndex: number | null;
  }) => void;
}
