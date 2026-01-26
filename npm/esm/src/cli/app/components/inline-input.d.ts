/****
 * Inline Text Input Component
 *
 * Renders an input prompt at the bottom of the TUI that stays inline
 * without exiting alternate screen mode.
 */
import type { InputState, LogEntry } from "../state.js";
export interface InlineInputOptions {
    maxWidth?: number;
}
/**
 * Render the inline input prompt
 */
export declare function renderInput(input: InputState, _options?: InlineInputOptions): string;
export interface RenderLogsOptions {
    maxLines?: number;
    maxWidth?: number;
    scroll?: number;
    expanded?: boolean;
}
/**
 * Render the logs area with optional scrolling
 */
export declare function renderLogs(logs: LogEntry[], options?: RenderLogsOptions): string;
/**
 * Handle input key press
 * Returns the new value and cursor position, or null if the key should end input
 */
export declare function handleInputKey(key: string, value: string, cursorPos: number): {
    value: string;
    cursorPos: number;
} | {
    action: "submit" | "cancel";
};
//# sourceMappingURL=inline-input.d.ts.map