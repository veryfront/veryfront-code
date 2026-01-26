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
 * Shared key press handler for all runtimes
 */
function handleKeyPress(key: string, options: KeyboardOptions): void {
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

function createNoopHandler(): KeyboardHandler {
  return {
    start() {},
    stop() {},
  };
}

// Cross-runtime implementation using platform abstractions
function createPlatformHandler(options: KeyboardOptions): KeyboardHandler {
  let running = false;
  let reader: ReturnType<typeof getStdinReader> | null = null;

  async function readLoop(): Promise<void> {
    if (!reader) return;

    while (running) {
      try {
        const { value, done } = await reader.read();
        if (done || !value) return;

        const byte = value[0];
        if (byte === undefined) continue;

        // Handle Ctrl+C (0x03)
        if (byte === 0x03) {
          options.onQuit?.();
          return;
        }

        handleKeyPress(String.fromCharCode(byte), options);
      } catch {
        // stdin closed or error, exit loop
        return;
      }
    }
  }

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
        reader?.releaseLock();
        reader = null;
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
  if (!isStdoutTTY()) return createNoopHandler();
  return createPlatformHandler(options);
}
