/**
 * Cross-runtime stdin utilities
 *
 * @module platform/compat/stdin
 */

import { isDeno } from "./runtime.ts";

// Node.js process global type declaration
declare const process: {
  stdin: {
    setRawMode?(enabled: boolean): void;
    resume(): void;
    pause(): void;
    on(event: string, listener: (data: Uint8Array) => void): void;
    once(event: string, listener: (data: Uint8Array) => void): void;
    off(event: string, listener: (data: Uint8Array) => void): void;
  };
} | undefined;

/**
 * Set raw mode on stdin (enables character-by-character input)
 */
export function setRawMode(enabled: boolean): void {
  if (isDeno) {
    Deno.stdin.setRaw(enabled);
    return;
  }

  if (typeof process === "undefined" || !process.stdin?.setRawMode) return;

  process.stdin.setRawMode(enabled);
  if (enabled) process.stdin.resume();
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
      read: async () => {
        const result = await reader.read();
        return { value: result.value, done: result.done };
      },
      releaseLock: () => reader.releaseLock(),
    };
  }

  if (typeof process === "undefined" || !process.stdin) {
    return {
      read: () => Promise.resolve({ value: undefined, done: true }),
      releaseLock: () => {},
    };
  }

  let buffer: Uint8Array[] = [];
  let resolveRead: ((result: { value: Uint8Array | undefined; done: boolean }) => void) | null =
    null;

  const onData = (data: Uint8Array) => {
    const chunk = new Uint8Array(data);
    if (resolveRead) {
      resolveRead({ value: chunk, done: false });
      resolveRead = null;
      return;
    }
    buffer.push(chunk);
  };

  const onEnd = () => {
    if (!resolveRead) return;
    resolveRead({ value: undefined, done: true });
    resolveRead = null;
  };

  process.stdin.on("data", onData);
  process.stdin.on("end", onEnd);

  return {
    read(): Promise<{ value: Uint8Array | undefined; done: boolean }> {
      const value = buffer.shift();
      if (value) return Promise.resolve({ value, done: false });

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

/**
 * Wait for a single keypress from stdin.
 * Works in both Deno and Node.js.
 */
export function waitForKeypress(): Promise<void> {
  return new Promise((resolve) => {
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

    if (!process?.stdin) {
      resolve();
      return;
    }

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
    if (typeof Deno !== "undefined" && Deno.stdin) {
      Deno.stdin.setRaw(true);
      const reader = Deno.stdin.readable.getReader();

      const cleanup = (result: boolean) => {
        Deno.stdin.setRaw(false);
        reader.releaseLock();
        resolve(result);
      };

      const readKey = async () => {
        const { value } = await reader.read();
        const key = value?.[0];
        if (key === undefined) return;

        if (key === CTRL_C) {
          cleanup(false);
          return;
        }

        if (key === ENTER_CR || key === ENTER_LF) {
          cleanup(true);
          return;
        }

        readKey();
      };

      readKey();
      return;
    }

    if (!process?.stdin) {
      resolve(false);
      return;
    }

    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();

    const cleanup = (result: boolean) => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.off("data", onData);
      resolve(result);
    };

    const onData = (data: Uint8Array) => {
      const key = data[0];
      if (key === CTRL_C) {
        cleanup(false);
        return;
      }
      if (key === ENTER_CR || key === ENTER_LF) {
        cleanup(true);
      }
    };

    stdin.on("data", onData);
  });
}
