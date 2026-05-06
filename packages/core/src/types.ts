/** Stroke ending type: tome, hane, harai. */
export type StrokeEndingType = "tome" | "hane" | "harai";

/**
 * A point sampled along a drawn stroke, with a timestamp.
 *
 * `x` and `y` are coord-space-agnostic; the receiving API decides the
 * contract:
 * - Mount callbacks ({@link CharStrokeData.points}) emit values in
 *   hanzi-writer's internal coordinate system (nominally 0..HANZI_COORD_SIZE,
 *   Y-up). Values are NOT clamped: if the user draws past the inner padded
 *   box, `x`/`y` can fall outside that range.
 * - {@link Char.judge}'s `points` argument expects internal coords by
 *   default, but accepts arbitrary source coords when `opts.sourceBox` is
 *   provided — judge() projects them into internal coords for you.
 *
 * `t` is milliseconds (typically `performance.now()`).
 *
 * The final element of a stroke array is treated as the moment the user
 * released the pointer: its `t` is the release time and its position is
 * usually the same as the previous sample. The gap `last.t - prev.t` is what
 * tome/hane/harai detection treats as "pause before release".
 */
export interface TimedPoint {
  x: number;
  y: number;
  t: number;
}

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
export interface CharStrokeData {
  /** The character being practiced. */
  character: string;
  /**
   * Logical stroke index (0-based; respects `strokeGroups` when configured).
   * If `strokeGroups` is set but does not map the current data stroke
   * (incomplete groups), this falls back to the underlying data-stroke index
   * rather than a logical index.
   */
  strokeNum: number;
  /**
   * True when hanzi-writer's matcher accepted the drawn stroke.
   * `onCorrectStroke` and `onStrokeEndingMistake` both set this to `true`
   * (the matcher accepted the stroke; only the ending may have been wrong);
   * `onMistake` sets it to `false`.
   * Mirrors {@link CharJudgeStrokeResult.matched} so the same shape applies
   * to mount and headless judging.
   */
  matched: boolean;
  /**
   * Similarity in [0, 1], derived from hanzi-writer's `getAverageDistance`
   * with the same threshold {@link Char.judge} uses (1 at perfect match,
   * clamped to 0 once the average distance reaches the leniency-scaled
   * threshold).
   * Mirrors {@link CharJudgeStrokeResult.similarity}.
   */
  similarity: number;
  /**
   * Sampled points the user drew for this stroke, in hanzi-writer internal
   * coords with timestamps. Suitable as the second argument to
   * {@link Char.judge} so the same stroke can be replayed against a headless
   * Char.
   */
  points: TimedPoint[];
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
   * If `strokeGroups` is set but does not map the current data stroke
   * (incomplete groups), this falls back to hanzi-writer's raw
   * data-stroke count rather than a logical count.
   */
  strokesRemaining: number;
  /** Stroke ending judgment. Present only when ending types are configured for this stroke. */
  strokeEnding?: StrokeEndingJudgment;
}
