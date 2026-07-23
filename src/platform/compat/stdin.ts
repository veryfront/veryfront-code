/**
 * Cross-runtime stdin utilities
 *
 * @module platform/compat/stdin
 */

import { getDenoRuntime, isDeno } from "./runtime.ts";

/** @internal Node.js stdin events consumed by this module. */
export type NodeStdinEvent = "data" | "end" | "close" | "error";

/** @internal Runtime-neutral Node.js stdin listener. */
export type NodeStdinListener = (value?: unknown) => void;

/** @internal Runtime-neutral subset of Node.js stdin used by this module. */
export interface NodeStdinStream {
  readonly isRaw?: boolean;
  readonly readableEnded?: boolean;
  readonly destroyed?: boolean;
  readonly errored?: unknown;
  readonly readableAborted?: boolean;
  readonly readableFlowing?: boolean | null;
  setRawMode?(enabled: boolean): void;
  resume(): void;
  pause(): void;
  isPaused?(): boolean;
  on(event: NodeStdinEvent, listener: NodeStdinListener): void;
  off(event: NodeStdinEvent, listener: NodeStdinListener): void;
}

type PropertyHost = object | ((...args: never[]) => unknown);

function readProperty(value: unknown, key: PropertyKey): unknown {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) return undefined;
  try {
    return Reflect.get(value as PropertyHost, key);
  } catch {
    return undefined;
  }
}

/** @internal Resolves a Node.js stdin stream without assuming process exists. */
export function getNodeStdinFromHost(host: unknown): NodeStdinStream | undefined {
  const stdin = readProperty(readProperty(host, "process"), "stdin");
  if (
    typeof readProperty(stdin, "resume") !== "function" ||
    typeof readProperty(stdin, "pause") !== "function" ||
    typeof readProperty(stdin, "on") !== "function" ||
    typeof readProperty(stdin, "off") !== "function"
  ) return undefined;
  return stdin as NodeStdinStream;
}

const knownRawModes = new WeakMap<object, boolean>();
const lockedNodeStdinStreams = new WeakSet<object>();
const nodeRawModeResumeOwners = new WeakSet<object>();

interface RawModeController {
  canSetRawMode(): boolean;
  getRawMode(): boolean | undefined;
  setRawMode(enabled: boolean): void;
  getPaused?(): boolean | undefined;
  resume?(): void;
  pause?(): void;
}

interface RawInput extends RawModeController {
  identity: object;
  getReader(): StdinReader;
}

const rawInputTails = new WeakMap<object, Promise<void>>();

function createStdinConfigurationError(): Error {
  return new Error("Failed to configure stdin");
}

function configureRawMode(controller: RawModeController, enabled: boolean): boolean {
  let previousRawMode: boolean | undefined;
  let previousPaused: boolean | undefined;
  let rawModeAttempted = false;
  let resumeAttempted = false;

  try {
    if (!controller.canSetRawMode()) return false;
    previousRawMode = controller.getRawMode();
    previousPaused = enabled ? controller.getPaused?.() : undefined;
    rawModeAttempted = true;
    controller.setRawMode(enabled);
    if (enabled && previousPaused !== false && controller.resume) {
      resumeAttempted = true;
      controller.resume();
    }
    return resumeAttempted;
  } catch {
    // Restore every state that may have changed before returning a stable error.
  }

  if (rawModeAttempted) {
    const restoreRawMode = previousRawMode ?? (enabled ? false : undefined);
    if (restoreRawMode !== undefined) {
      try {
        controller.setRawMode(restoreRawMode);
      } catch {
        // Continue with paused-state restoration.
      }
    }
  }
  if (resumeAttempted && previousPaused !== false && controller.pause) {
    try {
      controller.pause();
    } catch {
      // The stable configuration error below reports both failures.
    }
  }
  throw createStdinConfigurationError();
}

function createDenoRawModeController(stdin: typeof Deno.stdin): RawModeController {
  return {
    canSetRawMode: () => true,
    getRawMode: () => knownRawModes.get(stdin),
    setRawMode: (enabled) => {
      stdin.setRaw(enabled);
      knownRawModes.set(stdin, enabled);
    },
  };
}

function getNodePausedState(stdin: NodeStdinStream): boolean | undefined {
  const flowing = stdin.readableFlowing;
  if (flowing === true) return false;
  if (flowing === false || flowing === null) return true;
  return stdin.isPaused?.();
}

function createNodeRawModeController(stdin: NodeStdinStream): RawModeController {
  return {
    canSetRawMode: () => typeof stdin.setRawMode === "function",
    getRawMode: () => typeof stdin.isRaw === "boolean" ? stdin.isRaw : knownRawModes.get(stdin),
    setRawMode: (enabled) => {
      const setter = stdin.setRawMode;
      if (!setter) return;
      setter.call(stdin, enabled);
      knownRawModes.set(stdin, enabled);
    },
    getPaused: () => getNodePausedState(stdin),
    resume: () => stdin.resume(),
    pause: () => stdin.pause(),
  };
}

/** @internal Configures raw mode on an injected Node.js stdin stream. */
export function setNodeStdinRawMode(stdin: NodeStdinStream, enabled: boolean): void {
  const controller = createNodeRawModeController(stdin);
  if (enabled) {
    if (configureRawMode(controller, true)) nodeRawModeResumeOwners.add(stdin);
    return;
  }

  configureRawMode(controller, false);
  if (!nodeRawModeResumeOwners.has(stdin)) return;
  try {
    controller.pause?.();
    nodeRawModeResumeOwners.delete(stdin);
  } catch {
    throw createStdinConfigurationError();
  }
}

/**
 * Set raw mode on stdin (enables character-by-character input)
 */
export function setRawMode(enabled: boolean): void {
  const deno = isDeno ? getDenoRuntime() : undefined;
  if (deno) {
    configureRawMode(createDenoRawModeController(deno.stdin), enabled);
    return;
  }

  const stdin = getNodeStdinFromHost(globalThis);
  if (!stdin) return;

  setNodeStdinRawMode(stdin, enabled);
}

/**
 * Stdin reader interface for cross-runtime compatibility
 */
export interface StdinReader {
  read(): Promise<{ value: Uint8Array | undefined; done: boolean }>;
  releaseLock(): void;
}

/** @internal Runtime-neutral subset of a Web Streams stdin reader. */
export interface WebStdinReader {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
  releaseLock(): void;
}

type StdinReadResult = { value: Uint8Array | undefined; done: boolean };
type PendingStdinRead = {
  resolve: (result: StdinReadResult) => void;
  reject: (error: Error) => void;
};

function createReleasedReaderError(): TypeError {
  return new TypeError("The stdin reader was released");
}

function createLockedReaderError(): TypeError {
  return new TypeError("The stdin stream is already locked");
}

function createStdinReadError(): Error {
  return new Error("Failed to read from stdin");
}

function createStdinReleaseError(): Error {
  return new Error("Failed to release stdin reader");
}

/** @internal Wraps a Web Streams reader with the public stdin reader shape. */
export function createWebStdinReader(reader: WebStdinReader): StdinReader {
  const pendingReads = new Set<PendingStdinRead>();
  let failed = false;
  let released = false;

  function rejectPendingReads(errorFactory: () => Error): void {
    const reads = [...pendingReads];
    pendingReads.clear();
    for (const pendingRead of reads) pendingRead.reject(errorFactory());
  }

  function failRead(pendingRead: PendingStdinRead): void {
    if (!pendingReads.has(pendingRead)) return;
    failed = true;
    rejectPendingReads(createStdinReadError);
  }

  return {
    read: () => {
      if (released) return Promise.reject(createReleasedReaderError());
      if (failed) return Promise.reject(createStdinReadError());

      return new Promise((resolve, reject) => {
        const pendingRead = { resolve, reject };
        pendingReads.add(pendingRead);

        try {
          reader.read().then(
            (result) => {
              if (!pendingReads.has(pendingRead)) return;
              let value: Uint8Array | undefined;
              let done: boolean;
              try {
                value = result.value;
                done = result.done;
                if (
                  typeof done !== "boolean" ||
                  (value !== undefined && !(value instanceof Uint8Array))
                ) {
                  throw createStdinReadError();
                }
              } catch {
                failRead(pendingRead);
                return;
              }
              if (!pendingReads.delete(pendingRead)) return;
              resolve({ value, done });
            },
            () => failRead(pendingRead),
          );
        } catch {
          failRead(pendingRead);
        }
      });
    },
    releaseLock: () => {
      if (released) return;
      released = true;
      rejectPendingReads(createReleasedReaderError);
      try {
        reader.releaseLock();
      } catch {
        throw createStdinReleaseError();
      }
    },
  };
}

async function executeRawInput<T>(
  input: RawInput,
  operation: (reader: StdinReader) => Promise<T>,
): Promise<T> {
  let reader: StdinReader | undefined;
  let previousRawMode: boolean | undefined;
  let previousPaused: boolean | undefined;
  let rawModeSupported = false;
  let rawModeAttempted = false;
  let resumeAttempted = false;
  let outcome: { ok: true; value: T } | { ok: false } = { ok: false };

  try {
    rawModeSupported = input.canSetRawMode();
    if (rawModeSupported) previousRawMode = input.getRawMode();
    previousPaused = input.resume ? input.getPaused?.() : undefined;
    if (rawModeSupported && previousRawMode !== true) {
      rawModeAttempted = true;
      input.setRawMode(true);
    }
    reader = input.getReader();
    if (input.resume && previousPaused !== false) {
      resumeAttempted = true;
      input.resume();
    }
    outcome = { ok: true, value: await operation(reader) };
  } catch {
    // The stable error below keeps runtime-specific stdin details private.
  }

  let cleanupFailed = false;
  if (reader) {
    try {
      reader.releaseLock();
    } catch {
      cleanupFailed = true;
    }
  }
  if (rawModeAttempted) {
    try {
      input.setRawMode(previousRawMode ?? false);
    } catch {
      cleanupFailed = true;
    }
  }
  if (resumeAttempted && previousPaused !== false && input.pause) {
    let isPaused = false;
    try {
      isPaused = input.getPaused?.() === true;
    } catch {
      cleanupFailed = true;
    }
    if (!isPaused) {
      try {
        input.pause();
      } catch {
        cleanupFailed = true;
      }
    }
  }

  if (!outcome.ok || cleanupFailed) throw createStdinReadError();
  return outcome.value;
}

async function runRawInput<T>(
  input: RawInput,
  operation: (reader: StdinReader) => Promise<T>,
): Promise<T> {
  const previousTurn = rawInputTails.get(input.identity);
  let releaseTurn!: () => void;
  const currentTurn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const tail = previousTurn ? previousTurn.then(() => currentTurn) : currentTurn;
  rawInputTails.set(input.identity, tail);

  if (previousTurn) await previousTurn;
  try {
    return await executeRawInput(input, operation);
  } finally {
    releaseTurn();
    if (rawInputTails.get(input.identity) === tail) rawInputTails.delete(input.identity);
  }
}

/** @internal Creates a reader over an evented Node.js stdin stream. */
export function createNodeStdinReader(stdin: NodeStdinStream): StdinReader {
  if (lockedNodeStdinStreams.has(stdin)) throw createLockedReaderError();
  lockedNodeStdinStreams.add(stdin);

  let buffer: Uint8Array[] = [];
  let pendingReads: PendingStdinRead[] = [];
  let ended = false;
  let failed = false;
  let released = false;
  let shouldRestorePausedState = false;
  const attachedListeners = new Set<number>();

  function removeEventListeners(): boolean {
    let cleanupFailed = false;
    for (const index of [...attachedListeners].reverse()) {
      const [event, listener] = eventListeners[index]!;
      try {
        stdin.off(event, listener);
        attachedListeners.delete(index);
      } catch {
        cleanupFailed = true;
      }
    }
    return cleanupFailed;
  }

  function restoreFlowState(): boolean {
    if (!shouldRestorePausedState) return false;
    shouldRestorePausedState = false;
    try {
      stdin.pause();
      return false;
    } catch {
      return true;
    }
  }

  function onData(value?: unknown): void {
    if (ended || failed || released) return;
    if (!(value instanceof Uint8Array)) {
      onError(undefined);
      return;
    }
    const chunk = new Uint8Array(value);
    const pendingRead = pendingReads.shift();
    if (pendingRead) {
      pendingRead.resolve({ value: chunk, done: false });
      return;
    }
    buffer.push(chunk);
  }

  function onEnd(): void {
    if (ended || failed || released) return;
    ended = true;
    const cleanupFailed = removeEventListeners();
    const reads = pendingReads;
    pendingReads = [];
    if (cleanupFailed) {
      failed = true;
      buffer = [];
      for (const pendingRead of reads) {
        pendingRead.reject(createStdinReadError());
      }
      return;
    }
    for (const pendingRead of reads) {
      pendingRead.resolve({ value: undefined, done: true });
    }
  }

  function onError(_error?: unknown): void {
    if (ended || failed || released) return;
    failed = true;
    buffer = [];
    removeEventListeners();
    const reads = pendingReads;
    pendingReads = [];
    for (const pendingRead of reads) {
      pendingRead.reject(createStdinReadError());
    }
  }

  const eventListeners: ReadonlyArray<readonly [NodeStdinEvent, NodeStdinListener]> = [
    ["data", onData],
    ["end", onEnd],
    ["close", onEnd],
    ["error", onError],
  ];

  try {
    shouldRestorePausedState = getNodePausedState(stdin) !== false;
    for (const [index, [event, listener]] of eventListeners.entries()) {
      stdin.on(event, listener);
      attachedListeners.add(index);
    }
    const errored = stdin.errored;
    if ((errored !== undefined && errored !== null) || stdin.readableAborted === true) {
      onError(undefined);
    } else if (stdin.readableEnded === true || stdin.destroyed === true) {
      onEnd();
    }
  } catch {
    removeEventListeners();
    restoreFlowState();
    lockedNodeStdinStreams.delete(stdin);
    throw createStdinReadError();
  }

  return {
    read(): Promise<{ value: Uint8Array | undefined; done: boolean }> {
      if (released) return Promise.reject(createReleasedReaderError());
      if (failed) return Promise.reject(createStdinReadError());
      const value = buffer.shift();
      if (value) return Promise.resolve({ value, done: false });
      if (ended) return Promise.resolve({ value: undefined, done: true });

      return new Promise((resolve, reject) => {
        pendingReads.push({ resolve, reject });
      });
    },
    releaseLock(): void {
      if (released) return;
      released = true;
      lockedNodeStdinStreams.delete(stdin);
      const cleanupFailed = removeEventListeners();
      const flowRestoreFailed = restoreFlowState();
      buffer = [];
      const reads = pendingReads;
      pendingReads = [];
      for (const pendingRead of reads) {
        pendingRead.reject(createReleasedReaderError());
      }
      if (cleanupFailed || flowRestoreFailed) throw createStdinReleaseError();
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
    return createWebStdinReader(deno.stdin.readable.getReader());
  }

  const stdin = getNodeStdinFromHost(globalThis);
  if (!stdin) {
    return {
      read: () => Promise.resolve({ value: undefined, done: true }),
      releaseLock: () => {},
    };
  }

  return createNodeStdinReader(stdin);
}

function createDenoRawInput(stdin: typeof Deno.stdin): RawInput {
  return {
    ...createDenoRawModeController(stdin),
    identity: stdin,
    getReader: () => createWebStdinReader(stdin.readable.getReader()),
  };
}

function createNodeRawInput(stdin: NodeStdinStream): RawInput {
  return {
    ...createNodeRawModeController(stdin),
    identity: stdin,
    getReader: () => createNodeStdinReader(stdin),
  };
}

/** @internal Waits for one input event from an injected Node.js stdin stream. */
export function waitForNodeKeypress(stdin: NodeStdinStream): Promise<void> {
  return runRawInput(createNodeRawInput(stdin), async (reader) => {
    await reader.read();
  });
}

/**
 * Wait for a single keypress from stdin.
 * Works in both Deno and Node.js.
 */
export function waitForKeypress(): Promise<void> {
  const deno = isDeno ? getDenoRuntime() : undefined;
  if (deno) {
    return runRawInput(createDenoRawInput(deno.stdin), async (reader) => {
      await reader.read();
    });
  }

  const stdin = getNodeStdinFromHost(globalThis);
  if (!stdin) return Promise.resolve();
  return waitForNodeKeypress(stdin);
}

// Key codes for raw mode
const CTRL_C = 0x03;
const ENTER_CR = 0x0d;
const ENTER_LF = 0x0a;

function resultFromInput(data: Uint8Array): boolean | undefined {
  for (const key of data) {
    if (key === CTRL_C) return false;
    if (key === ENTER_CR || key === ENTER_LF) return true;
  }
  return undefined;
}

/** @internal Waits for Enter or Ctrl+C from an injected Node.js stdin stream. */
export function waitForNodeEnterOrExit(stdin: NodeStdinStream): Promise<boolean> {
  return runRawInput(createNodeRawInput(stdin), async (reader) => {
    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) return false;
      const result = resultFromInput(value);
      if (result !== undefined) return result;
    }
  });
}

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
export function waitForEnterOrExit(): Promise<boolean> {
  const deno = isDeno ? getDenoRuntime() : undefined;
  if (deno) {
    return runRawInput(createDenoRawInput(deno.stdin), async (reader) => {
      while (true) {
        const { value, done } = await reader.read();
        if (done || !value) return false;
        const result = resultFromInput(value);
        if (result !== undefined) return result;
      }
    });
  }

  const stdin = getNodeStdinFromHost(globalThis);
  if (!stdin) return Promise.resolve(false);
  return waitForNodeEnterOrExit(stdin);
}
