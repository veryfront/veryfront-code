/**
 * Keyboard input handler for CLI
 *
 * Provides cross-runtime keyboard input handling for interactive CLI features.
 * Supports Deno, Node.js, and Bun runtimes.
 */

import { isStdoutTTY } from "@veryfront/platform/compat/process.ts";

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
}

/**
 * Shared key press handler for all runtimes
 */
function handleKeyPress(key: string, options: KeyboardOptions): void {
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

// Deno-specific implementation
function createDenoHandler(options: KeyboardOptions): KeyboardHandler {
  let running = false;
  let originalMode: boolean | null = null;

  const readLoop = async () => {
    const buf = new Uint8Array(1);
    while (running) {
      try {
        const n = await Deno.stdin.read(buf);
        if (n === null) break;
        const byte = buf[0];
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
        // Save original mode and enable raw mode
        originalMode = Deno.stdin.isTerminal();
        if (originalMode) {
          Deno.stdin.setRaw(true);
        }
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
        if (originalMode !== null) {
          Deno.stdin.setRaw(false);
        }
      } catch {
        // Ignore errors restoring terminal
      }
    },
  };
}

// Node.js/Bun implementation
function createNodeHandler(options: KeyboardOptions): KeyboardHandler {
  let cleanup: (() => void) | null = null;

  return {
    start() {
      if (!isStdoutTTY()) return;
      try {
        // Dynamic import to avoid issues in Deno
        const process = globalThis.process;
        if (!process?.stdin?.setRawMode) return;

        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding("utf8");

        const handler = (key: string) => {
          // Ctrl+C
          if (key === "\u0003") {
            options.onQuit?.();
            return;
          }
          handleKeyPress(key, options);
        };

        process.stdin.on("data", handler);
        cleanup = () => {
          process.stdin.off("data", handler);
          process.stdin.setRawMode(false);
          process.stdin.pause();
        };
      } catch {
        // Failed to set up keyboard handler
      }
    },
    stop() {
      cleanup?.();
      cleanup = null;
    },
  };
}

/**
 * Create a keyboard handler for the current runtime
 */
export function createKeyboardHandler(options: KeyboardOptions): KeyboardHandler {
  // Check if we're in Deno
  if (typeof Deno !== "undefined" && Deno.stdin) {
    return createDenoHandler(options);
  }

  // Node.js or Bun
  if (typeof globalThis.process !== "undefined") {
    return createNodeHandler(options);
  }

  // Fallback: no-op handler
  return {
    start() {},
    stop() {},
  };
}
