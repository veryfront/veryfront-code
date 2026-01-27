/**
 * Dot Matrix Display for CLI
 *
 * Renders a 7x7 dot matrix with animation support.
 * Used for the Veryfront Code logo in CLI experiences.
 */
// The Veryfront Code logo pattern (1 = lit, 0 = off)
// VF monogram: upper-left block + lower-right block, connected at middle
import * as dntShim from "../../../_dnt.shims.js";
export const AGENT_FACE = [
    [0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0, 0, 0],
    [0, 1, 1, 1, 0, 0, 0],
    [0, 1, 1, 0, 1, 1, 0],
    [0, 0, 0, 1, 1, 1, 0],
    [0, 0, 0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0],
];
// Positions of the logo dots for snake animation
// Traces the VF shape: upper-left block → lower-right block
export const V_LOGO_POSITIONS = [
    [1, 1],
    [1, 2],
    [1, 3], // top row of upper block
    [2, 1],
    [2, 2],
    [2, 3], // middle row of upper block
    [3, 1],
    [3, 2], // left side of connection row
    [3, 4],
    [3, 5], // right side of connection row
    [4, 3],
    [4, 4],
    [4, 5], // top row of lower block
    [5, 3],
    [5, 4],
    [5, 5], // bottom row of lower block
];
const DEFAULT_OPTIONS = {
    litChar: "●",
    offChar: "○",
    litColor: "\x1b[97m", // Bright white
    offColor: "\x1b[38;5;240m", // Dark gray
    spacing: " ",
    prefix: "  ",
    compact: false,
};
// Compact mode uses smaller characters but keeps spacing for square aspect ratio
const COMPACT_OPTIONS = {
    litChar: "•",
    offChar: "·",
    spacing: " ",
};
const RESET = "\x1b[0m";
// Colors for spinning animation - shades of orange
const SPIN_COLORS = {
    bright: "\x1b[38;2;255;165;120m", // Bright orange (leading edge, toned down)
    orange: "\x1b[38;2;252;143;93m", // Brand orange
    mid: "\x1b[38;2;200;110;70m", // Mid orange (trailing)
    dim: "\x1b[38;2;140;80;50m", // Dim orange/brown
};
function resolveOptions(options) {
    if (options.compact)
        return { ...DEFAULT_OPTIONS, ...COMPACT_OPTIONS, ...options };
    return { ...DEFAULT_OPTIONS, ...options };
}
function renderPattern(pattern, opts) {
    return pattern.map((row) => {
        const dots = row.map((dot) => dot === 1
            ? `${opts.litColor}${opts.litChar}${RESET}`
            : `${opts.offColor}${opts.offChar}${RESET}`);
        return opts.prefix + dots.join(opts.spacing);
    });
}
/**
 * Render the pattern with a spinning blade effect
 * The blade sweeps across the lit dots, creating orange → purple gradient
 */
function renderSpinningPattern(pattern, frame, opts) {
    const centerRow = 3;
    const centerCol = 3;
    const totalFrames = 16; // Full rotation in 16 frames
    const bladeAngle = ((frame % totalFrames) / totalFrames) * Math.PI * 2;
    return pattern.map((row, rowIdx) => {
        const dots = row.map((dot, colIdx) => {
            if (dot !== 1) {
                return `${opts.offColor}${opts.offChar}${RESET}`;
            }
            // Calculate angle from center to this dot
            const dy = rowIdx - centerRow;
            const dx = colIdx - centerCol;
            let dotAngle = Math.atan2(dy, dx);
            if (dotAngle < 0)
                dotAngle += Math.PI * 2;
            // Calculate angular distance from the blade
            let angleDiff = dotAngle - bladeAngle;
            if (angleDiff < 0)
                angleDiff += Math.PI * 2;
            if (angleDiff > Math.PI)
                angleDiff = Math.PI * 2 - angleDiff;
            // Color based on angular distance from blade
            const normalizedDiff = angleDiff / Math.PI; // 0 = at blade, 1 = opposite
            let color;
            if (normalizedDiff < 0.15) {
                color = SPIN_COLORS.bright; // Leading edge - brightest orange
            }
            else if (normalizedDiff < 0.35) {
                color = SPIN_COLORS.orange; // Near blade - brand orange
            }
            else if (normalizedDiff < 0.6) {
                color = SPIN_COLORS.mid; // Trailing - mid orange
            }
            else {
                color = SPIN_COLORS.dim; // Far from blade - dim orange
            }
            return `${color}${opts.litChar}${RESET}`;
        });
        return opts.prefix + dots.join(opts.spacing);
    });
}
function renderPatternWithText(pattern, textLines, opts, spinFrame) {
    const faceLines = spinFrame !== undefined
        ? renderSpinningPattern(pattern, spinFrame, opts)
        : renderPattern(pattern, opts);
    const faceHeight = faceLines.length;
    const startLine = Math.floor((faceHeight - textLines.length) / 2);
    const result = faceLines.map((line, i) => {
        const textIndex = i - startLine;
        if (textIndex < 0 || textIndex >= textLines.length)
            return line;
        return line + "   " + textLines[textIndex];
    });
    return result.join("\n");
}
/**
 * Render a dot matrix pattern to a string
 */
export function renderDotMatrix(pattern, options = {}) {
    return renderPattern(pattern, resolveOptions(options)).join("\n");
}
/**
 * Generate a spinner frame with snake animation
 * The snake "builds up" by lighting dots in sequence around the V shape
 *
 * @param frameIndex Current frame (0 to V_LOGO_POSITIONS.length - 1)
 * @param tailLength How many dots are lit in the snake tail
 * @returns Pattern with snake animation
 */
export function generateSpinnerFrame(frameIndex, tailLength = 3) {
    const pattern = Array.from({ length: 7 }, () => Array(7).fill(0));
    const totalPositions = V_LOGO_POSITIONS.length;
    for (let i = 0; i < tailLength; i++) {
        const posIndex = (frameIndex - i + totalPositions) % totalPositions;
        const [row, col] = V_LOGO_POSITIONS[posIndex];
        pattern[row][col] = 1;
    }
    return pattern;
}
/**
 * Generate all spinner frames for the snake animation
 */
export function generateSpinnerFrames(tailLength = 3) {
    return V_LOGO_POSITIONS.map((_, i) => generateSpinnerFrame(i, tailLength));
}
/**
 * Get the agent face as a string
 */
export function getAgentFace(options = {}) {
    return renderDotMatrix(AGENT_FACE, options);
}
/**
 * Get the agent face with text aligned horizontally (like Claude Code)
 * Text lines appear to the right of the face, vertically centered
 */
export function getAgentFaceWithText(textLines, options = {}) {
    return renderPatternWithText(AGENT_FACE, textLines, resolveOptions(options));
}
/**
 * Get the agent face with spinning blade animation
 * Orange and purple dots rotate around the logo
 * @param textLines Text to show next to the face
 * @param frame Animation frame (0-15 for full rotation)
 * @param options Dot matrix options
 */
export function getSpinningAgentFace(textLines, frame, options = {}) {
    return renderPatternWithText(AGENT_FACE, textLines, resolveOptions(options), frame);
}
/**
 * Animated dot matrix display with spinner support
 */
export class AnimatedDotMatrix {
    pattern;
    options;
    frameIndex = 0;
    intervalId = null;
    _spinning = false;
    spinnerFrames;
    constructor(options = {}) {
        this.pattern = AGENT_FACE;
        this.options = resolveOptions(options);
        this.spinnerFrames = generateSpinnerFrames(4); // 4-dot tail for nice snake effect
    }
    /**
     * Whether the spinner is currently animating
     */
    get spinning() {
        return this._spinning;
    }
    /**
     * Render current frame
     */
    render() {
        return renderPattern(this.pattern, this.options).join("\n");
    }
    /**
     * Render current frame with text aligned horizontally
     */
    renderWithText(textLines) {
        return renderPatternWithText(this.pattern, textLines, this.options);
    }
    /**
     * Get height in lines
     */
    getHeight() {
        return this.pattern.length;
    }
    clearInterval() {
        if (!this.intervalId)
            return;
        clearInterval(this.intervalId);
        this.intervalId = null;
    }
    startInterval(onTick, intervalMs) {
        this.intervalId = dntShim.setInterval(onTick, intervalMs);
    }
    /**
     * Start snake spinner animation (runs indefinitely until stopped)
     * Dots light up in sequence around the V shape in a circular motion
     */
    startSpinner(onFrame, intervalMs = 80) {
        this.stop();
        this._spinning = true;
        this.frameIndex = 0;
        this.pattern = this.spinnerFrames[0];
        onFrame(this.render());
        this.startInterval(() => {
            this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
            this.pattern = this.spinnerFrames[this.frameIndex];
            onFrame(this.render());
        }, intervalMs);
    }
    /**
     * Start snake spinner animation with horizontal text (runs indefinitely)
     */
    startSpinnerWithText(textLines, onFrame, intervalMs = 80) {
        this.stop();
        this._spinning = true;
        this.frameIndex = 0;
        this.pattern = this.spinnerFrames[0];
        onFrame(this.renderWithText(textLines));
        this.startInterval(() => {
            this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
            this.pattern = this.spinnerFrames[this.frameIndex];
            onFrame(this.renderWithText(textLines));
        }, intervalMs);
    }
    /**
     * Spin for a specific number of rounds, then show complete logo
     * Returns a promise that resolves when animation completes
     */
    spinRounds(rounds, onFrame, intervalMs = 80) {
        return new Promise((resolve) => {
            this.stop();
            this._spinning = true;
            this.frameIndex = 0;
            const totalFrames = this.spinnerFrames.length * rounds;
            let frameCount = 0;
            this.pattern = this.spinnerFrames[0];
            onFrame(this.render());
            this.startInterval(() => {
                frameCount++;
                this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
                this.pattern = this.spinnerFrames[this.frameIndex];
                onFrame(this.render());
                if (frameCount < totalFrames)
                    return;
                this.stopSpinner();
                onFrame(this.render());
                resolve();
            }, intervalMs);
        });
    }
    /**
     * Spin for a specific number of rounds with horizontal text
     * Returns a promise that resolves when animation completes
     */
    spinRoundsWithText(rounds, textLines, onFrame, intervalMs = 80) {
        return new Promise((resolve) => {
            this.stop();
            this._spinning = true;
            this.frameIndex = 0;
            const totalFrames = this.spinnerFrames.length * rounds;
            let frameCount = 0;
            this.pattern = this.spinnerFrames[0];
            onFrame(this.renderWithText(textLines));
            this.startInterval(() => {
                frameCount++;
                this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
                this.pattern = this.spinnerFrames[this.frameIndex];
                onFrame(this.renderWithText(textLines));
                if (frameCount < totalFrames)
                    return;
                this.stopSpinner();
                onFrame(this.renderWithText(textLines));
                resolve();
            }, intervalMs);
        });
    }
    /**
     * Stop spinner and show complete V logo
     */
    stopSpinner() {
        this._spinning = false;
        this.clearInterval();
        this.pattern = AGENT_FACE;
    }
    /**
     * Stop all animations
     */
    stop() {
        this._spinning = false;
        this.clearInterval();
        this.pattern = AGENT_FACE;
    }
    /**
     * Set to normal face
     */
    reset() {
        this.stop();
        this.pattern = AGENT_FACE;
    }
    /**
     * Set custom pattern
     */
    setPattern(pattern) {
        this.pattern = pattern;
    }
}
/**
 * Simple one-liner with the face and optional message (horizontal layout)
 */
export function agentSays(message, options = {}) {
    return getAgentFaceWithText([message], options);
}
/**
 * Compact inline face (single line using special characters)
 */
export function getInlineFace() {
    return "\x1b[97m⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\x1b[0m";
}
