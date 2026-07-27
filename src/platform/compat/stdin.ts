/**
 * Cross-runtime stdin utilities
 *
 * @module platform/compat/stdin
 */

import { getDenoRuntime, isDeno } from "./runtime.ts";

type StdinDataListener = (data: Uint8Array) => void;
type StdinEndListener = () => void;
type StdinErrorListener = (error: unknown) => void;

/** @internal Minimal Node-compatible stream surface used by the adapter. */
export interface NodeStdinLike {
  readonly readableEnded?: boolean;
  setRawMode?(enabled: boolean): void;
  resume(): void;
  pause(): void;
  on(event: "data", listener: StdinDataListener): void;
  on(event: "end", listener: StdinEndListener): void;
  on(event: "error", listener: StdinErrorListener): void;
  off(event: "data", listener: StdinDataListener): void;
  off(event: "end", listener: StdinEndListener): void;
  off(event: "error", listener: StdinErrorListener): void;
}

function getNodeStdin(): NodeStdinLike | undefined {
  try {
    const process = Reflect.get(globalThis, "process") as { stdin?: NodeStdinLike } | undefined;
    return process?.stdin;
  } catch {
    return undefined;
  }
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

  const stdin = getNodeStdin();
  if (!stdin) return;

  stdin.setRawMode?.(enabled);
  if (!enabled) stdin.pause();
}

/**
 * Stdin reader interface for cross-runtime compatibility
 */
export interface StdinReader {
  read(): Promise<{ value: Uint8Array | undefined; done: boolean }>;
  releaseLock(): void;
}

type PendingRead = {
  resolve(result: { value: Uint8Array | undefined; done: boolean }): void;
  reject(error: unknown): void;
};

const MAX_BUFFERED_STDIN_BYTES = 1024 * 1024;

/** @internal Creates the Node stream-backed reader without consulting globals. */
export function createNodeStdinReader(stdin: NodeStdinLike): StdinReader {
  const buffer: Uint8Array[] = [];
  const pendingReads: PendingRead[] = [];
  let bufferedBytes = 0;
  let ended = stdin.readableEnded === true;
  let released = false;
  let pausedForBackpressure = false;
  let terminalError: unknown;

  function detach(): void {
    stdin.off("data", onData);
    stdin.off("end", onEnd);
    stdin.off("error", onError);
  }

  function settlePendingAsDone(): void {
    for (const pending of pendingReads.splice(0)) {
      pending.resolve({ value: undefined, done: true });
    }
  }

  function onData(data: Uint8Array): void {
    if (ended || released) return;

    const chunk = new Uint8Array(data);
    const pending = pendingReads.shift();
    if (pending) {
      pending.resolve({ value: chunk, done: false });
      return;
    }

    buffer.push(chunk);
    bufferedBytes += chunk.byteLength;
    if (bufferedBytes >= MAX_BUFFERED_STDIN_BYTES && !pausedForBackpressure) {
      stdin.pause();
      pausedForBackpressure = true;
    }
  }

  function onEnd(): void {
    if (ended || released) return;
    ended = true;
    detach();
    settlePendingAsDone();
  }

  function onError(error: unknown): void {
    if (ended || released) return;
    terminalError = error instanceof Error ? error : new Error("Standard input failed");
    ended = true;
    detach();
    for (const pending of pendingReads.splice(0)) {
      pending.reject(terminalError);
    }
  }

  if (!ended) {
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onError);
    stdin.resume();
  }

  return {
    read(): Promise<{ value: Uint8Array | undefined; done: boolean }> {
      const value = buffer.shift();
      if (value) {
        bufferedBytes -= value.byteLength;
        if (
          pausedForBackpressure &&
          bufferedBytes < MAX_BUFFERED_STDIN_BYTES / 2
        ) {
          stdin.resume();
          pausedForBackpressure = false;
        }
        return Promise.resolve({ value, done: false });
      }

      if (released) return Promise.resolve({ value: undefined, done: true });
      if (terminalError !== undefined) return Promise.reject(terminalError);
      if (ended) return Promise.resolve({ value: undefined, done: true });

      return new Promise((resolve, reject) => {
        pendingReads.push({ resolve, reject });
      });
    },
    releaseLock(): void {
      if (released) return;
      released = true;
      detach();
      stdin.pause();
      buffer.length = 0;
      bufferedBytes = 0;
      settlePendingAsDone();
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

  const stdin = getNodeStdin();
  if (!stdin) {
    return {
      read: () => Promise.resolve({ value: undefined, done: true }),
      releaseLock: () => {},
    };
  }

  return createNodeStdinReader(stdin);
}

/**
 * Wait for a single keypress from stdin.
 * Works in both Deno and Node.js.
 */
export async function waitForKeypress(): Promise<void> {
  setRawMode(true);
  const reader = getStdinReader();
  try {
    await reader.read();
  } finally {
    reader.releaseLock();
    setRawMode(false);
  }
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
    if (timeoutId !== null) {
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
export async function waitForEnterOrExit(): Promise<boolean> {
  setRawMode(true);
  const reader = getStdinReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return false;
      if (!value) continue;

      for (const key of value) {
        if (key === CTRL_C) return false;
        if (key === ENTER_CR || key === ENTER_LF) return true;
      }
    }
  } finally {
    reader.releaseLock();
    setRawMode(false);
  }
}
