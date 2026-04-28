export type StrokeEndingType = "tome" | "hane" | "harai";

export interface StrokeEnding {
  type: StrokeEndingType;
  direction: [number, number] | null;
}

export interface StrokeEndingJudgment {
  correct: boolean;
  expected: StrokeEndingType;
  confidence: number;
  velocityProfile: "decelerating" | "constant" | "accelerating";
  actualEndDirection: [number, number] | null;
}

export interface KakitoriStrokeData {
  character: string;
  strokeNum: number;
  drawnPath: {
    pathString: string;
    points: Array<{ x: number; y: number }>;
  };
  isBackwards: boolean;
  mistakesOnStroke: number;
  totalMistakes: number;
  strokesRemaining: number;
  strokeEnding?: StrokeEndingJudgment;
}
