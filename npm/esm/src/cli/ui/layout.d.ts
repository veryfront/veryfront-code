/**
 * Layout utilities for CLI
 *
 * Provides terminal-aware layout primitives for responsive CLI design.
 * Runtime-agnostic: works on Deno, Node.js, and Bun.
 */
/**
 * Get terminal width, with fallback for non-TTY environments
 */
export declare function getTerminalWidth(): number;
/**
 * Get terminal height, with fallback for non-TTY environments
 */
export declare function getTerminalHeight(): number;
/**
 * Check if output is a TTY (interactive terminal)
 */
export declare function isTTY(): boolean;
/**
 * Get visible length of a string (excluding ANSI escape codes)
 */
export declare function visibleLength(text: string): number;
/**
 * Truncate text to fit within maxWidth, adding ellipsis if needed
 */
export declare function truncate(text: string, maxWidth: number, ellipsis?: string): string;
/**
 * Pad text to a specific width
 */
export declare function pad(text: string, width: number, align?: "left" | "center" | "right"): string;
/**
 * Wrap text to fit within maxWidth
 * Returns array of lines
 */
export declare function wrap(text: string, maxWidth: number): string[];
/**
 * Repeat a character or string to fill width
 */
export declare function repeat(char: string, count: number): string;
/**
 * Strip ANSI escape codes from text
 */
export declare function stripAnsi(text: string): string;
/**
 * Split text into lines
 */
export declare function lines(text: string): string[];
/**
 * Get the maximum visible width of lines
 */
export declare function maxLineWidth(textLines: string[]): number;
//# sourceMappingURL=layout.d.ts.map