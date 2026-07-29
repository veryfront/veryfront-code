/**
 * Cross-runtime stdin utilities
 *
 * @module platform/compat/stdin
 */

import { getDenoRuntime, isDeno } from "./runtime.ts";

// Node.js process global type declaration
declare const process:
  | {
    stdin: {
      setRawMode?(enabled: boolean): void;
      resume(): void;
      pause(): void;
      on(event: string, listener: (data: Uint8Array) => void): void;
      once(event: string, listener: (data: Uint8Array) => void): void;
      off(event: string, listener: (data: Uint8Array) => void): void;
    };
  }
  | undefined;

export interface NodeRawStdinLike {
  setRawMode?(enabled: boolean): void;
}

export interface NodeKeypressStdinLike extends NodeRawStdinLike {
  pause(): void;
  resume(): void;
  once(event: string, listener: (data: Uint8Array) => void): void;
}

export function setNodeRawMode(stdin: NodeRawStdinLike, enabled: boolean): void {
  stdin.setRawMode?.(enabled);
}

/**
 * Set raw mode on stdin (enables character-by-character input)
 */
export function setRawMode(enabled: boolean): void {
  const deno = isDeno ? getDenoRuntime() : undefined;
  if (deno) {
    deno.stdin.setRaw(enabled);
    return;
  }

  const stdin = process?.stdin;
  if (!stdin?.setRawMode) return;

  setNodeRawMode(stdin, enabled);
}

/**
 * Stdin reader interface for cross-runtime compatibility
 */
export interface StdinReader {
  read(): Promise<{ value: Uint8Array | undefined; done: boolean }>;
  releaseLock(): void;
}

export interface NodeStdinLike {
  pause(): void;
  resume(): void;
  on(event: string, listener: (data: Uint8Array) => void): void;
  off(event: string, listener: (data: Uint8Array) => void): void;
}

/** Create a chunk reader over Node's event-based stdin stream. */
export function createNodeStdinReader(stdin: NodeStdinLike): StdinReader {
  let buffer: Uint8Array[] = [];
  let ended = false;
  let resolveRead: ((result: { value: Uint8Array | undefined; done: boolean }) => void) | null =
    null;

  function onData(data: Uint8Array): void {
    const chunk = new Uint8Array(data);
    if (resolveRead) {
      resolveRead({ value: chunk, done: false });
      resolveRead = null;
      return;
    }
    buffer.push(chunk);
  }

  function settleEnd(): void {
    ended = true;
    if (!resolveRead) return;
    resolveRead({ value: undefined, done: true });
    resolveRead = null;
  }

  stdin.on("data", onData);
  stdin.on("end", settleEnd);
  stdin.resume();

  return {
    read(): Promise<{ value: Uint8Array | undefined; done: boolean }> {
      const value = buffer.shift();
      if (value) return Promise.resolve({ value, done: false });
      if (ended) return Promise.resolve({ value: undefined, done: true });

      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    },
    releaseLock(): void {
      stdin.off("data", onData);
      stdin.off("end", settleEnd);
      stdin.pause();
      buffer = [];
      settleEnd();
    },
  };
}

/**
 * Get a reader for stdin (for raw mode character reading)
 * Returns an object with read() and releaseLock() methods
 */
export function getStdinReader(): StdinReader {
  const deno = isDeno ? getDenoRuntime() : undefined;
  if (deno) {
    const reader = deno.stdin.readable.getReader();
    return {
      read: async () => {
        const result = await reader.read();
        return { value: result.value, done: result.done };
      },
      releaseLock: () => reader.releaseLock(),
    };
  }

  const stdin = process?.stdin;
  if (!stdin) {
    return {
      read: () => Promise.resolve({ value: undefined, done: true }),
      releaseLock: () => {},
    };
  }

  return createNodeStdinReader(stdin);
}

/** Read one line from stdin and release the reader when complete. */
export async function readStdinLine(
  reader: StdinReader = getStdinReader(),
): Promise<string | null> {
  const decoder = new TextDecoder();
  let input = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        input += decoder.decode(value, { stream: !done });
      } else if (done) {
        input += decoder.decode();
      }
      const lineEnd = input.search(/[\r\n]/);
      if (lineEnd !== -1) return input.slice(0, lineEnd);
      if (done) return input || null;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Wait for a single keypress from stdin.
 * Works in both Deno and Node.js.
 */
export function waitForNodeKeypress(stdin: NodeKeypressStdinLike): Promise<void> {
  return new Promise((resolve) => {
    stdin.once("data", () => {
      setNodeRawMode(stdin, false);
      stdin.pause();
      resolve();
    });
    setNodeRawMode(stdin, true);
    stdin.resume();
  });
}

export function waitForKeypress(): Promise<void> {
  const deno = isDeno ? getDenoRuntime() : undefined;
  if (deno) {
    return (async () => {
      deno.stdin.setRaw(true);
      const reader = deno.stdin.readable.getReader();
      try {
        await reader.read();
      } finally {
        deno.stdin.setRaw(false);
        reader.releaseLock();
      }
    })();
  }

  const stdin = process?.stdin;
  return stdin ? waitForNodeKeypress(stdin) : Promise.resolve();
}

// Key codes for raw mode
const CTRL_C = 0x03;
const ENTER_CR = 0x0d;
const ENTER_LF = 0x0a;

/**
 * Buffer for escape sequences that may arrive in separate reads.
 * Arrow keys (\x1b[A) can arrive as "\x1b" then "[A" - this combines them.
 */
export interface EscapeBuffer {
  push(input: string): string | null;
  clear(): void;
}

const ESC = "\x1b";
const ESC_TIMEOUT_MS = 50;

/**
 * Create an escape sequence buffer.
 * @param onTimeout Called when a standalone Escape key times out
 */
export function createEscapeBuffer(onTimeout: (key: string) => void): EscapeBuffer {
  let pending = "";
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function clear(): void {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    pending = "";
  }

  function push(input: string): string | null {
    if (pending) {
      const result = pending + input;
      clear();
      return result;
    }

    if (input !== ESC) return input;

    pending = input;
    timeoutId = setTimeout(() => {
      const key = pending;
      clear();
      if (key) onTimeout(key);
    }, ESC_TIMEOUT_MS);

    return null;
  }

  return { push, clear };
}

/**
 * Wait for Enter key or Ctrl+C.
 * Returns true if Enter was pressed (continue), false if Ctrl+C (exit).
 * Works in both Deno and Node.js.
 */
export function waitForEnterOrExit(): Promise<boolean> {
  return new Promise((resolve) => {
    const deno = isDeno ? getDenoRuntime() : undefined;
    if (deno) {
      deno.stdin.setRaw(true);
      const reader = deno.stdin.readable.getReader();

      const cleanup = (result: boolean) => {
        deno.stdin.setRaw(false);
        reader.releaseLock();
        resolve(result);
      };

      const readKey = async (): Promise<void> => {
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

    const stdin = process?.stdin;
    if (!stdin) {
      resolve(false);
      return;
    }

    stdin.setRawMode?.(true);
    stdin.resume();

    const cleanup = (result: boolean) => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.off("data", onData);
      resolve(result);
    };

    const onData = (data: Uint8Array) => {
      if (data.length === 0) return;
      const key = data[0];
      if (key === CTRL_C) {
        cleanup(false);
        return;
      }
      if (key === ENTER_CR || key === ENTER_LF) cleanup(true);
    };

    stdin.on("data", onData);
  });
}
