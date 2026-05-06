/**
 * Structural types for the hanzi-writer internals char.ts depends on but
 * the upstream package does not export. Pinned by
 * `hanziWriterContract.test.ts` so a hanzi-writer version that breaks
 * these assumptions fails CI before the patch silently misbehaves.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface QuizStrokeMeta {
  isStrokeBackwards: boolean;
}

export interface DrawnStrokeData {
  drawnPath: {
    pathString: string;
    points: Pt[];
  };
  isBackwards: boolean;
  mistakesOnStroke: number;
  totalMistakes: number;
  strokesRemaining: number;
}

/**
 * The private `_quiz` instance hanzi-writer attaches to a HanziWriter
 * after `quiz()` resolves. char.ts patches `_handleSuccess` to inject
 * stroke ending judgment.
 *
 * `_userStroke` is set by hanzi-writer before it calls `_handleSuccess`;
 * tests that drive `_handleSuccess` directly populate it themselves.
 */
export interface HanziQuiz {
  _currentStrokeIndex: number;
  _totalMistakes: number;
  _handleSuccess: (meta: QuizStrokeMeta) => void;
  _handleFailure: (meta: QuizStrokeMeta) => void;
  _getStrokeData: (args: { isCorrect: boolean; meta: QuizStrokeMeta }) => DrawnStrokeData;
  _userStroke?: { points: Pt[]; externalPoints?: Pt[] };
  /**
   * Public method on hanzi-writer's Quiz that runs the stroke matcher and
   * dispatches to `_handleSuccess` / `_handleFailure`. char.judge sets
   * `_userStroke` and `_currentStrokeIndex`, then calls this to obtain the
   * verdict via patched handlers.
   */
  endUserStroke(): void;
  __kakitoriPatched?: boolean;
}

/**
 * Subset of hanzi-writer's character data we read for direction
 * auto-computation and animation.
 */
export interface HanziCharacterData {
  strokes: ReadonlyArray<{
    path: string;
    points: ReadonlyArray<Pt>;
  }>;
}
