/**
 * Keyboard input handler for CLI
 *
 * Provides cross-runtime keyboard input handling for interactive CLI features.
 * Uses platform abstractions for Deno, Node.js, and Bun runtimes.
 */
export interface KeyboardHandler {
    /** Start listening for keyboard input */
    start(): void;
    /** Stop listening and restore terminal */
    stop(): void;
}
export interface KeyboardOptions {
    /** Handler for 'o' key - open in browser */
    onOpen?: () => void;
    /** Handler for 'c' key - clear console */
    onClear?: () => void;
    /** Handler for 'q' key - quit */
    onQuit?: () => void;
    /** Handler for number keys 1-9 */
    onNumber?: (n: number) => void;
    /** Handler for 'a' key - auth/login */
    onAuth?: () => void;
    /** Handler for 's' key - show projects */
    onSync?: () => void;
    /** Handler for 'l' key - toggle logs */
    onLogs?: () => void;
    /** Handler for 'p' key - pull */
    onPull?: () => void;
    /** Handler for 'u' key - push */
    onPush?: () => void;
}
/**
 * Create a keyboard handler for the current runtime
 * Uses platform abstractions that work across Deno, Node.js, and Bun
 */
export declare function createKeyboardHandler(options: KeyboardOptions): KeyboardHandler;
//# sourceMappingURL=keyboard.d.ts.map