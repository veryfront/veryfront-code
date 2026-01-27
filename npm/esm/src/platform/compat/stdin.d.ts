/**
 * Set raw mode on stdin (enables character-by-character input)
 */
export declare function setRawMode(enabled: boolean): void;
/**
 * Stdin reader interface for cross-runtime compatibility
 */
export interface StdinReader {
    read(): Promise<{
        value: Uint8Array | undefined;
        done: boolean;
    }>;
    releaseLock(): void;
}
/**
 * Get a reader for stdin (for raw mode character reading)
 * Returns an object with read() and releaseLock() methods
 */
export declare function getStdinReader(): StdinReader;
/**
 * Wait for a single keypress from stdin.
 * Works in both Deno and Node.js.
 */
export declare function waitForKeypress(): Promise<void>;
/**
 * Wait for Enter key or Ctrl+C.
 * Returns true if Enter was pressed (continue), false if Ctrl+C (exit).
 * Works in both Deno and Node.js.
 */
/**
 * Buffer for escape sequences that may arrive in separate reads.
 * Arrow keys (\x1b[A) can arrive as "\x1b" then "[A" - this combines them.
 */
export interface EscapeBuffer {
    push(input: string): string | null;
    clear(): void;
}
/**
 * Create an escape sequence buffer.
 * @param onTimeout Called when a standalone Escape key times out
 */
export declare function createEscapeBuffer(onTimeout: (key: string) => void): EscapeBuffer;
export declare function waitForEnterOrExit(): Promise<boolean>;
//# sourceMappingURL=stdin.d.ts.map