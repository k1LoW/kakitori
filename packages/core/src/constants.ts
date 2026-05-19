// Default canvas size for char.create() and char.render().
// Independent from BASE_SIZE in StrokeEndingChecker (calibration baseline); they may diverge.
export const DEFAULT_SIZE = 300;

// Default padding for char.create() and char.render().
export const DEFAULT_PADDING = 0;

// hanzi-writer's source coord canvas. Character paths and medians from
// hanzi-writer-data live inside `x ∈ [0, HANZI_PRESCALED_SIZE]` and
// `y ∈ [HANZI_Y_MIN, HANZI_Y_MAX]`. The canvas is square (1024 × 1024).
// kakitori projects pointer input to this same space so it can be passed
// to hanzi-writer's matcher / `Char.checkStroke`.
//
// Mirror of CHARACTER_BOUNDS in hanzi-writer:
//   [{ x: 0, y: -124 }, { x: 1024, y: 900 }]
//
// All four values below are derived from this single bounding box, and
// the formulas baked into kakitori (projection / Y-flip / char.render
// transform) rely on these invariants:
//   HANZI_PRESCALED_SIZE === HANZI_Y_MAX - HANZI_Y_MIN  (square canvas)
//   HANZI_Y_BASELINE_OFFSET === -HANZI_Y_MIN            (positive equiv.)

/** Side length of hanzi-writer's source canvas (square, 1024 px). */
export const HANZI_PRESCALED_SIZE = 1024;
/** Top of character in hanzi-writer Y (Y-up). */
export const HANZI_Y_MAX = 900;
/** Bottom of character (descender) in hanzi-writer Y. */
export const HANZI_Y_MIN = -124;
/** `|HANZI_Y_MIN|` — character extends this far below the y=0 baseline. */
export const HANZI_Y_BASELINE_OFFSET = -HANZI_Y_MIN;
