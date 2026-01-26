export interface TypewriterOptions {
    /** Delay between characters in ms (default: 30) */
    charDelay?: number;
    /** Delay between words in ms when using word mode (default: 100) */
    wordDelay?: number;
    /** Animation mode: 'char' or 'word' (default: 'char') */
    mode?: "char" | "word";
    /** Whether to hide cursor during animation (default: true) */
    hideCursor?: boolean;
}
/**
 * Type text with animated effect
 */
export declare function typeText(text: string, options?: TypewriterOptions): Promise<void>;
/**
 * Type a line with newline at end
 */
export declare function typeLine(text: string, options?: TypewriterOptions): Promise<void>;
/**
 * Display a command with special formatting ($ prefix)
 */
export declare function typeCommand(command: string, options?: TypewriterOptions): Promise<void>;
export declare const HIDE_CURSOR: "\u001B[?25l";
export declare const SHOW_CURSOR: "\u001B[?25h";
//# sourceMappingURL=animated-text.d.ts.map