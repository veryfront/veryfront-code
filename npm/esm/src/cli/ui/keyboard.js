/**
 * Keyboard input handler for CLI
 *
 * Provides cross-runtime keyboard input handling for interactive CLI features.
 * Uses platform abstractions for Deno, Node.js, and Bun runtimes.
 */
import { isStdoutTTY } from "../../platform/compat/process.js";
import { getStdinReader, setRawMode } from "../../platform/compat/stdin.js";
/**
 * Shared key press handler for all runtimes
 */
function handleKeyPress(key, options) {
    if (key >= "1" && key <= "9") {
        options.onNumber?.(Number.parseInt(key, 10));
        return;
    }
    switch (key.toLowerCase()) {
        case "o":
            options.onOpen?.();
            return;
        case "c":
            options.onClear?.();
            return;
        case "q":
            options.onQuit?.();
            return;
        case "a":
            options.onAuth?.();
            return;
        case "s":
            options.onSync?.();
            return;
        case "l":
            options.onLogs?.();
            return;
        case "p":
            options.onPull?.();
            return;
        case "u":
            options.onPush?.();
            return;
    }
}
function createNoopHandler() {
    return {
        start() { },
        stop() { },
    };
}
// Cross-runtime implementation using platform abstractions
function createPlatformHandler(options) {
    let running = false;
    let reader = null;
    async function readLoop() {
        if (!reader)
            return;
        while (running) {
            try {
                const { value, done } = await reader.read();
                if (done || !value)
                    return;
                const byte = value[0];
                if (byte === undefined)
                    continue;
                // Handle Ctrl+C (0x03)
                if (byte === 0x03) {
                    options.onQuit?.();
                    return;
                }
                handleKeyPress(String.fromCharCode(byte), options);
            }
            catch {
                // stdin closed or error, exit loop
                return;
            }
        }
    }
    return {
        start() {
            if (!isStdoutTTY())
                return;
            try {
                setRawMode(true);
                reader = getStdinReader();
                running = true;
                // Start reading in background (don't await)
                readLoop();
            }
            catch {
                // Failed to set raw mode, keyboard shortcuts won't work
            }
        },
        stop() {
            running = false;
            try {
                reader?.releaseLock();
                reader = null;
                setRawMode(false);
            }
            catch {
                // Ignore errors restoring terminal
            }
        },
    };
}
/**
 * Create a keyboard handler for the current runtime
 * Uses platform abstractions that work across Deno, Node.js, and Bun
 */
export function createKeyboardHandler(options) {
    if (!isStdoutTTY())
        return createNoopHandler();
    return createPlatformHandler(options);
}
