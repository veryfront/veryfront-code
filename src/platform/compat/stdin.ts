/**
 * Cross-runtime stdin utilities
 *
 * @module platform/compat/stdin
 */

import { isDeno } from "./runtime.ts";

/**
 * Set raw mode on stdin (enables character-by-character input)
 */
export function setRawMode(enabled: boolean): void {
  if (isDeno) {
    Deno.stdin.setRaw(enabled);
  } else if (typeof process !== "undefined" && process.stdin?.setRawMode) {
    process.stdin.setRawMode(enabled);
    if (enabled) {
      process.stdin.resume();
    }
  }
}

/**
 * Stdin reader interface for cross-runtime compatibility
 */
export interface StdinReader {
  read(): Promise<{ value: Uint8Array | undefined; done: boolean }>;
  releaseLock(): void;
}

/**
 * Get a reader for stdin (for raw mode character reading)
 * Returns an object with read() and releaseLock() methods
 */
export function getStdinReader(): StdinReader {
  if (isDeno) {
    const reader = Deno.stdin.readable.getReader();
    return {
      async read() {
        const result = await reader.read();
        return { value: result.value, done: result.done };
      },
      releaseLock() {
        reader.releaseLock();
      },
    };
  }

  // Node.js implementation
  if (typeof process !== "undefined" && process.stdin) {
    let buffer: Uint8Array[] = [];
    let resolveRead: ((result: { value: Uint8Array | undefined; done: boolean }) => void) | null =
      null;

    const onData = (data: Uint8Array) => {
      const chunk = new Uint8Array(data);
      if (resolveRead) {
        resolveRead({ value: chunk, done: false });
        resolveRead = null;
      } else {
        buffer.push(chunk);
      }
    };

    const onEnd = () => {
      if (resolveRead) {
        resolveRead({ value: undefined, done: true });
        resolveRead = null;
      }
    };

    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);

    return {
      read(): Promise<{ value: Uint8Array | undefined; done: boolean }> {
        if (buffer.length > 0) {
          return Promise.resolve({ value: buffer.shift()!, done: false });
        }
        return new Promise((resolve) => {
          resolveRead = resolve;
        });
      },
      releaseLock(): void {
        process.stdin.off("data", onData);
        process.stdin.off("end", onEnd);
        buffer = [];
        resolveRead = null;
      },
    };
  }

  // Fallback: return a no-op reader
  return {
    read: () => Promise.resolve({ value: undefined, done: true }),
    releaseLock: () => {},
  };
}

/**
 * Wait for a single keypress from stdin.
 * Works in both Deno and Node.js.
 */
export function waitForKeypress(): Promise<void> {
  return new Promise((resolve) => {
    // Deno
    if (typeof Deno !== "undefined" && Deno.stdin) {
      Deno.stdin.setRaw(true);
      const reader = Deno.stdin.readable.getReader();

      reader.read().then(() => {
        Deno.stdin.setRaw(false);
        reader.releaseLock();
        resolve();
      });
      return;
    }

    // Node.js
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      resolve();
    });
  });
}

// Key codes for raw mode
const CTRL_C = 0x03;
const ENTER_CR = 0x0d;
const ENTER_LF = 0x0a;

/**
 * Wait for Enter key or Ctrl+C.
 * Returns true if Enter was pressed (continue), false if Ctrl+C (exit).
 * Works in both Deno and Node.js.
 */
export function waitForEnterOrExit(): Promise<boolean> {
  return new Promise((resolve) => {
    // Deno
    if (typeof Deno !== "undefined" && Deno.stdin) {
      Deno.stdin.setRaw(true);
      const reader = Deno.stdin.readable.getReader();

      const readKey = async () => {
        const { value } = await reader.read();
        if (value && value.length > 0) {
          const key = value[0];
          if (key === CTRL_C) {
            Deno.stdin.setRaw(false);
            reader.releaseLock();
            resolve(false);
            return;
          }
          if (key === ENTER_CR || key === ENTER_LF) {
            Deno.stdin.setRaw(false);
            reader.releaseLock();
            resolve(true);
            return;
          }
          // Other key - keep waiting
          readKey();
        }
      };
      readKey();
      return;
    }

    // Node.js
    process.stdin.setRawMode?.(true);
    process.stdin.resume();

    const onData = (data: Uint8Array) => {
      const key = data[0];
      if (key === CTRL_C) {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        resolve(false);
        return;
      }
      if (key === ENTER_CR || key === ENTER_LF) {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        resolve(true);
        return;
      }
      // Other key - keep listening
    };

    process.stdin.on("data", onData);
  });
}
