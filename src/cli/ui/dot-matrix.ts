/**
 * Dot Matrix Display for CLI
 *
 * Renders a 7x7 dot matrix with animation support.
 * Used for the Veryfront agent face in CLI experiences.
 */

// The Veryfront agent face pattern (1 = lit, 0 = off)
// Closed loop: top (2,3,4), right side (5), bottom (4,3,2), left side (1)
export const AGENT_FACE: number[][] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 1, 1, 0, 0],
  [0, 1, 0, 0, 0, 1, 0],
  [0, 1, 0, 0, 0, 1, 0],
  [0, 1, 0, 0, 0, 1, 0],
  [0, 0, 1, 1, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0],
];

// Positions of the logo dots in clockwise order for snake animation
// Forms a closed loop that the snake can traverse
export const V_LOGO_POSITIONS: [number, number][] = [
  [1, 2], // top left
  [1, 3], // top center
  [1, 4], // top right
  [2, 5], // right side top
  [3, 5], // right side middle
  [4, 5], // right side bottom
  [5, 4], // bottom right
  [5, 3], // bottom center
  [5, 2], // bottom left
  [4, 1], // left side bottom
  [3, 1], // left side middle
  [2, 1], // left side top
];

export interface DotMatrixOptions {
  /** Character for lit dots */
  litChar?: string;
  /** Character for off dots */
  offChar?: string;
  /** Color for lit dots (ANSI escape) */
  litColor?: string;
  /** Color for off dots (ANSI escape) */
  offColor?: string;
  /** Spacing between dots */
  spacing?: string;
  /** Prefix for each line (indentation) */
  prefix?: string;
  /** Use compact mode (smaller dots, no spacing) */
  compact?: boolean;
}

const DEFAULT_OPTIONS: Required<DotMatrixOptions> = {
  litChar: "●",
  offChar: "○",
  litColor: "\x1b[97m", // Bright white
  offColor: "\x1b[38;5;240m", // Dark gray
  spacing: " ",
  prefix: "  ",
  compact: false,
};

// Compact mode uses smaller characters but keeps spacing for square aspect ratio
const COMPACT_OPTIONS: Partial<DotMatrixOptions> = {
  litChar: "•",
  offChar: "·",
  spacing: " ",
};

const RESET = "\x1b[0m";

/**
 * Render a dot matrix pattern to a string
 */
export function renderDotMatrix(
  pattern: number[][],
  options: DotMatrixOptions = {},
): string {
  // Apply compact overrides if compact mode is enabled
  const baseOpts = options.compact
    ? { ...DEFAULT_OPTIONS, ...COMPACT_OPTIONS, ...options }
    : { ...DEFAULT_OPTIONS, ...options };
  const opts = baseOpts;
  const lines: string[] = [];

  for (const row of pattern) {
    const dots = row.map((dot) => {
      if (dot === 1) {
        return `${opts.litColor}${opts.litChar}${RESET}`;
      }
      return `${opts.offColor}${opts.offChar}${RESET}`;
    });
    lines.push(opts.prefix + dots.join(opts.spacing));
  }

  return lines.join("\n");
}

/**
 * Generate a spinner frame with snake animation
 * The snake "builds up" by lighting dots in sequence around the V shape
 *
 * @param frameIndex Current frame (0 to V_LOGO_POSITIONS.length - 1)
 * @param tailLength How many dots are lit in the snake tail
 * @returns Pattern with snake animation
 */
export function generateSpinnerFrame(frameIndex: number, tailLength = 3): number[][] {
  // Start with empty grid
  const pattern: number[][] = Array.from({ length: 7 }, () => Array(7).fill(0));

  const totalPositions = V_LOGO_POSITIONS.length;

  // Light up the snake tail (tailLength dots ending at frameIndex)
  for (let i = 0; i < tailLength; i++) {
    const posIndex = (frameIndex - i + totalPositions) % totalPositions;
    const [row, col] = V_LOGO_POSITIONS[posIndex]!;
    pattern[row]![col] = 1;
  }

  return pattern;
}

/**
 * Generate all spinner frames for the snake animation
 */
export function generateSpinnerFrames(tailLength = 3): number[][][] {
  const frames: number[][][] = [];
  for (let i = 0; i < V_LOGO_POSITIONS.length; i++) {
    frames.push(generateSpinnerFrame(i, tailLength));
  }
  return frames;
}

/**
 * Get the agent face as a string
 */
export function getAgentFace(options: DotMatrixOptions = {}): string {
  return renderDotMatrix(AGENT_FACE, options);
}

/**
 * Get the agent face with text aligned horizontally (like Claude Code)
 * Text lines appear to the right of the face, vertically centered
 */
export function getAgentFaceWithText(
  textLines: string[],
  options: DotMatrixOptions = {},
): string {
  // Apply compact overrides if compact mode is enabled
  const opts = options.compact
    ? { ...DEFAULT_OPTIONS, ...COMPACT_OPTIONS, ...options }
    : { ...DEFAULT_OPTIONS, ...options };
  const faceLines: string[] = [];

  // Render face
  for (const row of AGENT_FACE) {
    const dots = row.map((dot) => {
      if (dot === 1) {
        return `${opts.litColor}${opts.litChar}${RESET}`;
      }
      return `${opts.offColor}${opts.offChar}${RESET}`;
    });
    faceLines.push(opts.prefix + dots.join(opts.spacing));
  }

  // Calculate vertical centering for text
  const faceHeight = faceLines.length;
  const textHeight = textLines.length;
  const startLine = Math.floor((faceHeight - textHeight) / 2);

  // Combine face with text
  const result: string[] = [];
  for (let i = 0; i < faceHeight; i++) {
    let line = faceLines[i]!;
    const textIndex = i - startLine;
    if (textIndex >= 0 && textIndex < textLines.length) {
      line += "   " + textLines[textIndex];
    }
    result.push(line);
  }

  return result.join("\n");
}

/**
 * Animated dot matrix display with spinner support
 */
export class AnimatedDotMatrix {
  private pattern: number[][];
  private options: Required<DotMatrixOptions>;
  private frameIndex = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _spinning = false;
  private spinnerFrames: number[][][];

  constructor(options: DotMatrixOptions = {}) {
    this.pattern = AGENT_FACE;
    // Apply compact overrides if compact mode is enabled
    this.options = options.compact
      ? { ...DEFAULT_OPTIONS, ...COMPACT_OPTIONS, ...options } as Required<DotMatrixOptions>
      : { ...DEFAULT_OPTIONS, ...options };
    this.spinnerFrames = generateSpinnerFrames(4); // 4-dot tail for nice snake effect
  }

  /**
   * Whether the spinner is currently animating
   */
  get spinning(): boolean {
    return this._spinning;
  }

  /**
   * Render current frame
   */
  render(): string {
    return renderDotMatrix(this.pattern, this.options);
  }

  /**
   * Render current frame with text aligned horizontally
   */
  renderWithText(textLines: string[]): string {
    const faceLines: string[] = [];

    // Render face pattern
    for (const row of this.pattern) {
      const dots = row.map((dot) => {
        if (dot === 1) {
          return `${this.options.litColor}${this.options.litChar}${RESET}`;
        }
        return `${this.options.offColor}${this.options.offChar}${RESET}`;
      });
      faceLines.push(this.options.prefix + dots.join(this.options.spacing));
    }

    // Calculate vertical centering for text
    const faceHeight = faceLines.length;
    const textHeight = textLines.length;
    const startLine = Math.floor((faceHeight - textHeight) / 2);

    // Combine face with text
    const result: string[] = [];
    for (let i = 0; i < faceHeight; i++) {
      let line = faceLines[i]!;
      const textIndex = i - startLine;
      if (textIndex >= 0 && textIndex < textLines.length) {
        line += "   " + textLines[textIndex];
      }
      result.push(line);
    }

    return result.join("\n");
  }

  /**
   * Get height in lines
   */
  getHeight(): number {
    return this.pattern.length;
  }

  /**
   * Start snake spinner animation (runs indefinitely until stopped)
   * Dots light up in sequence around the V shape in a circular motion
   */
  startSpinner(onFrame: (frame: string) => void, intervalMs = 80): void {
    this.stop();
    this._spinning = true;
    this.frameIndex = 0;

    // Immediately show first frame
    this.pattern = this.spinnerFrames[0]!;
    onFrame(this.render());

    this.intervalId = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
      this.pattern = this.spinnerFrames[this.frameIndex]!;
      onFrame(this.render());
    }, intervalMs);
  }

  /**
   * Start snake spinner animation with horizontal text (runs indefinitely)
   */
  startSpinnerWithText(
    textLines: string[],
    onFrame: (frame: string) => void,
    intervalMs = 80,
  ): void {
    this.stop();
    this._spinning = true;
    this.frameIndex = 0;

    // Immediately show first frame
    this.pattern = this.spinnerFrames[0]!;
    onFrame(this.renderWithText(textLines));

    this.intervalId = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
      this.pattern = this.spinnerFrames[this.frameIndex]!;
      onFrame(this.renderWithText(textLines));
    }, intervalMs);
  }

  /**
   * Spin for a specific number of rounds, then show complete logo
   * Returns a promise that resolves when animation completes
   */
  spinRounds(
    rounds: number,
    onFrame: (frame: string) => void,
    intervalMs = 80,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.stop();
      this._spinning = true;
      this.frameIndex = 0;

      const totalFrames = this.spinnerFrames.length * rounds;
      let frameCount = 0;

      // Immediately show first frame
      this.pattern = this.spinnerFrames[0]!;
      onFrame(this.render());

      this.intervalId = setInterval(() => {
        frameCount++;
        this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
        this.pattern = this.spinnerFrames[this.frameIndex]!;
        onFrame(this.render());

        if (frameCount >= totalFrames) {
          this.stopSpinner();
          onFrame(this.render()); // Show complete logo
          resolve();
        }
      }, intervalMs);
    });
  }

  /**
   * Spin for a specific number of rounds with horizontal text
   * Returns a promise that resolves when animation completes
   */
  spinRoundsWithText(
    rounds: number,
    textLines: string[],
    onFrame: (frame: string) => void,
    intervalMs = 80,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.stop();
      this._spinning = true;
      this.frameIndex = 0;

      const totalFrames = this.spinnerFrames.length * rounds;
      let frameCount = 0;

      // Immediately show first frame
      this.pattern = this.spinnerFrames[0]!;
      onFrame(this.renderWithText(textLines));

      this.intervalId = setInterval(() => {
        frameCount++;
        this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
        this.pattern = this.spinnerFrames[this.frameIndex]!;
        onFrame(this.renderWithText(textLines));

        if (frameCount >= totalFrames) {
          this.stopSpinner();
          onFrame(this.renderWithText(textLines)); // Show complete logo
          resolve();
        }
      }, intervalMs);
    });
  }

  /**
   * Stop spinner and show complete V logo
   */
  stopSpinner(): void {
    this._spinning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.pattern = AGENT_FACE;
  }

  /**
   * Stop all animations
   */
  stop(): void {
    this._spinning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.pattern = AGENT_FACE;
  }

  /**
   * Set to normal face
   */
  reset(): void {
    this.stop();
    this.pattern = AGENT_FACE;
  }

  /**
   * Set custom pattern
   */
  setPattern(pattern: number[][]): void {
    this.pattern = pattern;
  }
}

/**
 * Simple one-liner with the face and optional message (horizontal layout)
 */
export function agentSays(message: string, options: DotMatrixOptions = {}): string {
  return getAgentFaceWithText([message], options);
}

/**
 * Compact inline face (single line using special characters)
 */
export function getInlineFace(): string {
  // Using Braille patterns for a compact representation
  return "\x1b[97m⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\x1b[0m";
}
