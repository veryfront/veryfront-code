/**
 * Keyboard input handler for CLI
 *
 * Provides cross-runtime keyboard input handling for interactive CLI features.
 * Uses platform abstractions for Deno, Node.js, and Bun runtimes.
 */

import { isStdoutTTY } from "#veryfront/platform/compat/process.ts";
import { getStdinReader, setRawMode } from "#veryfront/platform/compat/stdin.ts";

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
}

/**
 * Shared key press handler for all runtimes
 */
function handleKeyPress(key: string, options: KeyboardOptions): void {
  // Check for number keys 1-9
  if (key >= "1" && key <= "9") {
    options.onNumber?.(parseInt(key, 10));
    return;
  }

  switch (key.toLowerCase()) {
    case "o":
      options.onOpen?.();
      break;
    case "c":
      options.onClear?.();
      break;
    case "q":
      options.onQuit?.();
      break;
  }
}

// Cross-runtime implementation using platform abstractions
function createPlatformHandler(options: KeyboardOptions): KeyboardHandler {
  let running = false;
  let reader: ReturnType<typeof getStdinReader> | null = null;

  const readLoop = async () => {
    if (!reader) return;
    while (running) {
      try {
        const { value, done } = await reader.read();
        if (done || !value) break;
        const byte = value[0];
        if (byte === undefined) continue;
        // Handle Ctrl+C (0x03)
        if (byte === 0x03) {
          options.onQuit?.();
          break;
        }
        const char = String.fromCharCode(byte);
        handleKeyPress(char, options);
      } catch {
        // stdin closed or error, exit loop
        break;
      }
    }
  };

  return {
    start() {
      if (!isStdoutTTY()) return;
      try {
        setRawMode(true);
        reader = getStdinReader();
        running = true;
        // Start reading in background (don't await)
        readLoop();
      } catch {
        // Failed to set raw mode, keyboard shortcuts won't work
      }
    },
    stop() {
      running = false;
      try {
        if (reader) {
          reader.releaseLock();
          reader = null;
        }
        setRawMode(false);
      } catch {
        // Ignore errors restoring terminal
      }
    },
  };
}

/**
 * Create a keyboard handler for the current runtime
 * Uses platform abstractions that work across Deno, Node.js, and Bun
 */
export function createKeyboardHandler(options: KeyboardOptions): KeyboardHandler {
  // Check if we have a TTY - if not, return no-op handler
  if (!isStdoutTTY()) {
    return {
      start() {},
      stop() {},
    };
  }

  // Use platform abstractions which handle all runtimes
  return createPlatformHandler(options);
}
