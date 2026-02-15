/******************
 * Dot Matrix Display for CLI
 *
 * Renders a 7x7 dot matrix with animation support.
 * Used for the Veryfront logo in CLI experiences.
 ******************/

export const AGENT_FACE: number[][] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 0, 0, 0],
  [0, 1, 1, 1, 0, 0, 0],
  [0, 1, 1, 0, 1, 1, 0],
  [0, 0, 0, 1, 1, 1, 0],
  [0, 0, 0, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 0],
];

export const V_LOGO_POSITIONS: [number, number][] = [
  [1, 1],
  [1, 2],
  [1, 3],
  [2, 1],
  [2, 2],
  [2, 3],
  [3, 1],
  [3, 2],
  [3, 4],
  [3, 5],
  [4, 3],
  [4, 4],
  [4, 5],
  [5, 3],
  [5, 4],
  [5, 5],
];

export interface DotMatrixOptions {
  litChar?: string;
  offChar?: string;
  litColor?: string;
  offColor?: string;
  spacing?: string;
  prefix?: string;
  compact?: boolean;
}

const DEFAULT_OPTIONS: Required<DotMatrixOptions> = {
  litChar: "●",
  offChar: "○",
  litColor: "\x1b[97m",
  offColor: "\x1b[38;5;240m",
  spacing: " ",
  prefix: "  ",
  compact: false,
};

const COMPACT_OPTIONS: Partial<DotMatrixOptions> = {
  litChar: "•",
  offChar: "·",
  spacing: " ",
};

const RESET = "\x1b[0m";

const SPIN_COLORS = {
  bright: "\x1b[38;2;255;165;120m",
  orange: "\x1b[38;2;252;143;93m",
  mid: "\x1b[38;2;200;110;70m",
  dim: "\x1b[38;2;140;80;50m",
};

function resolveOptions(options: DotMatrixOptions): Required<DotMatrixOptions> {
  if (options.compact) return { ...DEFAULT_OPTIONS, ...COMPACT_OPTIONS, ...options };
  return { ...DEFAULT_OPTIONS, ...options };
}

function renderPattern(pattern: number[][], opts: Required<DotMatrixOptions>): string[] {
  return pattern.map((row) => {
    const dots = row.map((dot) => {
      if (dot === 1) return `${opts.litColor}${opts.litChar}${RESET}`;
      return `${opts.offColor}${opts.offChar}${RESET}`;
    });

    return opts.prefix + dots.join(opts.spacing);
  });
}

function renderSpinningPattern(
  pattern: number[][],
  frame: number,
  opts: Required<DotMatrixOptions>,
): string[] {
  const centerRow = 3;
  const centerCol = 3;
  const totalFrames = 16;
  const bladeAngle = ((frame % totalFrames) / totalFrames) * Math.PI * 2;

  return pattern.map((row, rowIdx) => {
    const dots = row.map((dot, colIdx) => {
      if (dot !== 1) return `${opts.offColor}${opts.offChar}${RESET}`;

      const dy = rowIdx - centerRow;
      const dx = colIdx - centerCol;

      let dotAngle = Math.atan2(dy, dx);
      if (dotAngle < 0) dotAngle += Math.PI * 2;

      let angleDiff = dotAngle - bladeAngle;
      if (angleDiff < 0) angleDiff += Math.PI * 2;
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

      const normalizedDiff = angleDiff / Math.PI;

      let color = SPIN_COLORS.dim;
      if (normalizedDiff < 0.15) color = SPIN_COLORS.bright;
      else if (normalizedDiff < 0.35) color = SPIN_COLORS.orange;
      else if (normalizedDiff < 0.6) color = SPIN_COLORS.mid;

      return `${color}${opts.litChar}${RESET}`;
    });

    return opts.prefix + dots.join(opts.spacing);
  });
}

function renderPatternWithText(
  pattern: number[][],
  textLines: string[],
  opts: Required<DotMatrixOptions>,
  spinFrame?: number,
): string {
  const faceLines = spinFrame === undefined
    ? renderPattern(pattern, opts)
    : renderSpinningPattern(pattern, spinFrame, opts);

  const startLine = Math.floor((faceLines.length - textLines.length) / 2);

  return faceLines
    .map((line, i) => {
      const textIndex = i - startLine;
      if (textIndex < 0 || textIndex >= textLines.length) return line;
      return `${line}   ${textLines[textIndex]}`;
    })
    .join("\n");
}

export function renderDotMatrix(pattern: number[][], options: DotMatrixOptions = {}): string {
  return renderPattern(pattern, resolveOptions(options)).join("\n");
}

export function generateSpinnerFrame(frameIndex: number, tailLength = 3): number[][] {
  const pattern: number[][] = Array.from({ length: 7 }, () => Array(7).fill(0));
  const totalPositions = V_LOGO_POSITIONS.length;

  for (let i = 0; i < tailLength; i++) {
    const posIndex = (frameIndex - i + totalPositions) % totalPositions;
    const [row, col] = V_LOGO_POSITIONS[posIndex]!;
    pattern[row]![col] = 1;
  }

  return pattern;
}

export function generateSpinnerFrames(tailLength = 3): number[][][] {
  return V_LOGO_POSITIONS.map((_, i) => generateSpinnerFrame(i, tailLength));
}

export function getAgentFace(options: DotMatrixOptions = {}): string {
  return renderDotMatrix(AGENT_FACE, options);
}

export function getAgentFaceWithText(textLines: string[], options: DotMatrixOptions = {}): string {
  return renderPatternWithText(AGENT_FACE, textLines, resolveOptions(options));
}

export function getSpinningAgentFace(
  textLines: string[],
  frame: number,
  options: DotMatrixOptions = {},
): string {
  return renderPatternWithText(AGENT_FACE, textLines, resolveOptions(options), frame);
}

export class AnimatedDotMatrix {
  private pattern: number[][];
  private options: Required<DotMatrixOptions>;
  private frameIndex = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _spinning = false;
  private spinnerFrames: number[][][];

  constructor(options: DotMatrixOptions = {}) {
    this.pattern = AGENT_FACE;
    this.options = resolveOptions(options);
    this.spinnerFrames = generateSpinnerFrames(4);
  }

  get spinning(): boolean {
    return this._spinning;
  }

  render(): string {
    return renderPattern(this.pattern, this.options).join("\n");
  }

  renderWithText(textLines: string[]): string {
    return renderPatternWithText(this.pattern, textLines, this.options);
  }

  getHeight(): number {
    return this.pattern.length;
  }

  private clearInterval(): void {
    if (this.intervalId === null) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  private startInterval(onTick: () => void, intervalMs: number): void {
    this.intervalId = setInterval(onTick, intervalMs);
  }

  startSpinner(onFrame: (frame: string) => void, intervalMs = 80): void {
    this.stop();
    this._spinning = true;
    this.frameIndex = 0;

    this.pattern = this.spinnerFrames[0]!;
    onFrame(this.render());

    this.startInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
      this.pattern = this.spinnerFrames[this.frameIndex]!;
      onFrame(this.render());
    }, intervalMs);
  }

  startSpinnerWithText(
    textLines: string[],
    onFrame: (frame: string) => void,
    intervalMs = 80,
  ): void {
    this.stop();
    this._spinning = true;
    this.frameIndex = 0;

    this.pattern = this.spinnerFrames[0]!;
    onFrame(this.renderWithText(textLines));

    this.startInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
      this.pattern = this.spinnerFrames[this.frameIndex]!;
      onFrame(this.renderWithText(textLines));
    }, intervalMs);
  }

  spinRounds(rounds: number, onFrame: (frame: string) => void, intervalMs = 80): Promise<void> {
    return new Promise((resolve) => {
      this.stop();
      this._spinning = true;
      this.frameIndex = 0;

      const totalFrames = this.spinnerFrames.length * rounds;
      let frameCount = 0;

      this.pattern = this.spinnerFrames[0]!;
      onFrame(this.render());

      this.startInterval(() => {
        frameCount++;
        this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
        this.pattern = this.spinnerFrames[this.frameIndex]!;
        onFrame(this.render());

        if (frameCount < totalFrames) return;

        this.stopSpinner();
        onFrame(this.render());
        resolve();
      }, intervalMs);
    });
  }

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

      this.pattern = this.spinnerFrames[0]!;
      onFrame(this.renderWithText(textLines));

      this.startInterval(() => {
        frameCount++;
        this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
        this.pattern = this.spinnerFrames[this.frameIndex]!;
        onFrame(this.renderWithText(textLines));

        if (frameCount < totalFrames) return;

        this.stopSpinner();
        onFrame(this.renderWithText(textLines));
        resolve();
      }, intervalMs);
    });
  }

  stopSpinner(): void {
    this._spinning = false;
    this.clearInterval();
    this.pattern = AGENT_FACE;
  }

  stop(): void {
    this._spinning = false;
    this.clearInterval();
    this.pattern = AGENT_FACE;
  }

  reset(): void {
    this.stop();
    this.pattern = AGENT_FACE;
  }

  setPattern(pattern: number[][]): void {
    this.pattern = pattern;
  }
}

export function agentSays(message: string, options: DotMatrixOptions = {}): string {
  return getAgentFaceWithText([message], options);
}

export function getInlineFace(): string {
  return "\x1b[97m⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\x1b[0m";
}
