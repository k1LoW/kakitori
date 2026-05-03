/** Stroke ending type: tome, hane, harai. */
export type StrokeEndingType = "tome" | "hane" | "harai";

/** Stroke ending configuration for a single logical stroke. */
export interface StrokeEnding {
  /** Acceptable ending types. Empty or omitted disables ending judgment for this stroke. */
  types?: StrokeEndingType[];
  /**
   * Expected end direction as a normalized 2D vector, used for hane/harai validation.
   * When null or omitted and `types` includes hane/harai, direction is best-effort
   * auto-computed from the median's last segment when character data is available;
   * if character data has not loaded yet, direction-based validation is skipped.
   */
  direction?: [number, number] | null;
}

/** Result of stroke ending judgment for a completed stroke. */
export interface StrokeEndingJudgment {
  /** True if the detected ending type is in the expected list. */
  correct: boolean;
  /** Configured expected ending types from `StrokeEnding.types`. */
  expected: StrokeEndingType[] | undefined;
  /** Confidence in [0, 1]. Higher when both type and direction match strongly. */
  confidence: number;
  /** Velocity profile near the stroke endpoint. Discriminates harai (accelerating) from tome (decelerating). */
  velocityProfile: "decelerating" | "constant" | "accelerating";
  /** Normalized direction vector of the stroke's last segment, or null when undeterminable. */
  actualEndDirection: [number, number] | null;
}

/** Per-stroke callback payload. Fired on onCorrectStroke / onMistake / onStrokeEndingMistake. */
export interface KakitoriStrokeData {
  /** The character being practiced. */
  character: string;
  /** Logical stroke index (0-based; respects strokeGroups when configured). */
  strokeNum: number;
  /** The path the user actually drew for this stroke. */
  drawnPath: {
    /** SVG path string of the drawn trajectory. */
    pathString: string;
    /** Sampled points along the drawn trajectory, in HanziWriter coordinate space. */
    points: Array<{ x: number; y: number }>;
  };
  /** True if hanzi-writer detected the stroke was drawn in reverse direction. */
  isBackwards: boolean;
  /** Mistakes accumulated on the current stroke before it was accepted. */
  mistakesOnStroke: number;
  /** Mistakes accumulated across the entire character so far. */
  totalMistakes: number;
  /**
   * Logical strokes remaining (respects `strokeGroups`). Excludes the current
   * stroke when the stroke is being accepted (`onCorrectStroke`, or
   * `onStrokeEndingMistake` with `strokeEndingAsMiss=false`); includes the
   * current stroke when it is being rejected (`onMistake`, or
   * `onStrokeEndingMistake` with `strokeEndingAsMiss=true`).
   */
  strokesRemaining: number;
  /** Stroke ending judgment. Present only when ending types are configured for this stroke. */
  strokeEnding?: StrokeEndingJudgment;
}
