import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  chainPrivatePromise,
  observePrivatePromise,
  resolvePrivatePromise,
} from "#veryfront/security/private-promise.ts";

const apply = Reflect.apply;
const setPrototypeOf = Object.setPrototypeOf;
const freeze = Object.freeze;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const NativeReadableStream = ReadableStream;
const controllerEnqueue = ReadableStreamDefaultController.prototype.enqueue;
const controllerClose = ReadableStreamDefaultController.prototype.close;
const controllerError = ReadableStreamDefaultController.prototype.error;
const controllerDesiredSize = ownDescriptor(
  ReadableStreamDefaultController.prototype,
  "desiredSize",
)!.get!;
const streamGetReader = ReadableStream.prototype.getReader;
const streamCancel = ReadableStream.prototype.cancel;
const streamLocked = Object.getOwnPropertyDescriptor(ReadableStream.prototype, "locked")!.get!;
const ownedReaders = createPrivateWeakStore<ReadableStreamDefaultReader<unknown>, true>();
const readerRead = ReadableStreamDefaultReader.prototype.read;
const readerCancel = ReadableStreamDefaultReader.prototype.cancel;
const readerReleaseLock = ReadableStreamDefaultReader.prototype.releaseLock;
const readerClosed = Object.getOwnPropertyDescriptor(
  ReadableStreamDefaultReader.prototype,
  "closed",
)!.get!;
const streamGetWriter = WritableStream.prototype.getWriter;
const writerWrite = WritableStreamDefaultWriter.prototype.write;
const writerAbort = WritableStreamDefaultWriter.prototype.abort;
const writerReleaseLock = WritableStreamDefaultWriter.prototype.releaseLock;

/** Keep private transport writes and cleanup independent of replaced stream methods. */
export function getPrivateStreamWriter<T>(
  stream: WritableStream<T>,
): Pick<WritableStreamDefaultWriter<T>, "write" | "abort" | "releaseLock"> {
  const writer = apply(streamGetWriter, stream, []) as WritableStreamDefaultWriter<T>;
  const facade = {
    __proto__: null,
    write: (chunk?: T) =>
      observePrivatePromise(apply(writerWrite, writer, [chunk]) as Promise<void>),
    abort: (reason?: unknown) =>
      observePrivatePromise(apply(writerAbort, writer, [reason]) as Promise<void>),
    releaseLock: () => {
      apply(writerReleaseLock, writer, []);
    },
  };
  return freeze(facade);
}

function ownData<T extends object, K extends keyof T>(value: T, key: K): T[K] | undefined {
  const descriptor = ownDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw new TypeError("Private stream options require data properties");
  }
  return descriptor.value as T[K];
}

function privateController<T>(
  controller: ReadableStreamDefaultController<T>,
): ReadableStreamDefaultController<T> {
  const facade: ReadableStreamDefaultController<T> = {
    enqueue: (chunk?: T) => {
      apply(controllerEnqueue, controller, [chunk]);
    },
    close: () => {
      apply(controllerClose, controller, []);
    },
    error: (reason?: unknown) => {
      apply(controllerError, controller, [reason]);
    },
    get desiredSize() {
      return apply(controllerDesiredSize, controller, []) as number | null;
    },
  };
  setPrototypeOf(facade, null);
  return freeze(facade);
}

/** Construct a default stream without exposing its source or controller through global hooks. */
export function createPrivateReadableStream<T>(
  source: UnderlyingDefaultSource<T>,
  strategy?: QueuingStrategy<T>,
): ReadableStream<T> {
  const start = ownData(source, "start");
  const pull = ownData(source, "pull");
  const cancel = ownData(source, "cancel");
  let controller: ReadableStreamDefaultController<T>;
  const invoke = (callback: unknown, args: unknown[]) => {
    if (callback === undefined) return undefined;
    if (typeof callback !== "function") {
      throw new TypeError("Private stream callback must be a function");
    }
    const result = apply(callback, source, args);
    return result === undefined
      ? undefined
      : chainPrivatePromise(resolvePrivatePromise(), () => result);
  };
  const privateSource = {
    __proto__: null,
    start(nativeController: ReadableStreamDefaultController<T>) {
      controller = privateController(nativeController);
      return invoke(start, [controller]);
    },
    pull() {
      return invoke(pull, [controller]);
    },
    cancel(reason: unknown) {
      return invoke(cancel, [reason]);
    },
  };
  const privateStrategy = {
    __proto__: null,
    highWaterMark: strategy === undefined ? undefined : ownData(strategy, "highWaterMark"),
    size: strategy === undefined ? undefined : ownData(strategy, "size"),
  };
  return new NativeReadableStream<T>(privateSource, privateStrategy);
}

/** Keep private stream consumption independent of replaced Web Streams methods. */
export function getPrivateStreamReader<T>(
  stream: ReadableStream<T>,
): ReadableStreamDefaultReader<T> {
  const reader = apply(streamGetReader, stream, []) as ReadableStreamDefaultReader<T>;
  return protectPrivateStreamReader(reader);
}

export function protectPrivateStreamReader<T>(
  reader: ReadableStreamDefaultReader<T>,
): ReadableStreamDefaultReader<T> {
  if (ownedReaders.get(reader)) return reader;
  const facade: ReadableStreamDefaultReader<T> = {
    read: () =>
      observePrivatePromise(apply(readerRead, reader, []) as Promise<ReadableStreamReadResult<T>>),
    cancel: (reason?: unknown) =>
      observePrivatePromise(apply(readerCancel, reader, [reason]) as Promise<void>),
    releaseLock: () => {
      apply(readerReleaseLock, reader, []);
    },
    get closed() {
      return observePrivatePromise(apply(readerClosed, reader, []) as Promise<void>);
    },
  };
  setPrototypeOf(facade, null);
  ownedReaders.set(facade, true);
  return freeze(facade);
}

export function cancelPrivateStream(
  stream: ReadableStream<unknown>,
  reason?: unknown,
): Promise<void> {
  return observePrivatePromise(apply(streamCancel, stream, [reason]) as Promise<void>);
}

export function isPrivateStreamLocked(stream: ReadableStream<unknown>): boolean {
  return apply(streamLocked, stream, []) as boolean;
}

export const PrivateReadableStream = NativeReadableStream;

type ControllerOperation = (...args: never[]) => unknown;

function controllerMethod(
  controller: ReadableStreamDefaultController<unknown>,
  key: string,
  native: ControllerOperation,
): ControllerOperation {
  // Internal forwarding controllers provide own methods; native controllers inherit theirs.
  const descriptor = ownDescriptor(controller, key);
  return descriptor && hasOwn(descriptor, "value") && typeof descriptor.value === "function"
    ? descriptor.value
    : native;
}

export function enqueuePrivateStream<T>(controller: ReadableStreamDefaultController<T>, value: T) {
  apply(controllerMethod(controller, "enqueue", controllerEnqueue), controller, [value]);
}

export function closePrivateStream(controller: ReadableStreamDefaultController) {
  apply(controllerMethod(controller, "close", controllerClose), controller, []);
}

export function errorPrivateStream(controller: ReadableStreamDefaultController, reason: unknown) {
  apply(controllerMethod(controller, "error", controllerError), controller, [reason]);
}
