/**
 * Dot Matrix Display for CLI
 *
 * Renders a 7x7 dot matrix with animation support.
 * Used for the Veryfront Code logo in CLI experiences.
 */
export declare const AGENT_FACE: number[][];
export declare const V_LOGO_POSITIONS: [number, number][];
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
/**
 * Render a dot matrix pattern to a string
 */
export declare function renderDotMatrix(pattern: number[][], options?: DotMatrixOptions): string;
/**
 * Generate a spinner frame with snake animation
 * The snake "builds up" by lighting dots in sequence around the V shape
 *
 * @param frameIndex Current frame (0 to V_LOGO_POSITIONS.length - 1)
 * @param tailLength How many dots are lit in the snake tail
 * @returns Pattern with snake animation
 */
export declare function generateSpinnerFrame(frameIndex: number, tailLength?: number): number[][];
/**
 * Generate all spinner frames for the snake animation
 */
export declare function generateSpinnerFrames(tailLength?: number): number[][][];
/**
 * Get the agent face as a string
 */
export declare function getAgentFace(options?: DotMatrixOptions): string;
/**
 * Get the agent face with text aligned horizontally (like Claude Code)
 * Text lines appear to the right of the face, vertically centered
 */
export declare function getAgentFaceWithText(textLines: string[], options?: DotMatrixOptions): string;
/**
 * Animated dot matrix display with spinner support
 */
export declare class AnimatedDotMatrix {
    private pattern;
    private options;
    private frameIndex;
    private intervalId;
    private _spinning;
    private spinnerFrames;
    constructor(options?: DotMatrixOptions);
    /**
     * Whether the spinner is currently animating
     */
    get spinning(): boolean;
    /**
     * Render current frame
     */
    render(): string;
    /**
     * Render current frame with text aligned horizontally
     */
    renderWithText(textLines: string[]): string;
    /**
     * Get height in lines
     */
    getHeight(): number;
    private clearInterval;
    private startInterval;
    /**
     * Start snake spinner animation (runs indefinitely until stopped)
     * Dots light up in sequence around the V shape in a circular motion
     */
    startSpinner(onFrame: (frame: string) => void, intervalMs?: number): void;
    /**
     * Start snake spinner animation with horizontal text (runs indefinitely)
     */
    startSpinnerWithText(textLines: string[], onFrame: (frame: string) => void, intervalMs?: number): void;
    /**
     * Spin for a specific number of rounds, then show complete logo
     * Returns a promise that resolves when animation completes
     */
    spinRounds(rounds: number, onFrame: (frame: string) => void, intervalMs?: number): Promise<void>;
    /**
     * Spin for a specific number of rounds with horizontal text
     * Returns a promise that resolves when animation completes
     */
    spinRoundsWithText(rounds: number, textLines: string[], onFrame: (frame: string) => void, intervalMs?: number): Promise<void>;
    /**
     * Stop spinner and show complete V logo
     */
    stopSpinner(): void;
    /**
     * Stop all animations
     */
    stop(): void;
    /**
     * Set to normal face
     */
    reset(): void;
    /**
     * Set custom pattern
     */
    setPattern(pattern: number[][]): void;
}
/**
 * Simple one-liner with the face and optional message (horizontal layout)
 */
export declare function agentSays(message: string, options?: DotMatrixOptions): string;
/**
 * Compact inline face (single line using special characters)
 */
export declare function getInlineFace(): string;
//# sourceMappingURL=dot-matrix.d.ts.map