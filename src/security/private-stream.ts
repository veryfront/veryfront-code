import { observePrivatePromise } from "#veryfront/security/private-promise.ts";

const apply = Reflect.apply;
const setPrototypeOf = Object.setPrototypeOf;
const freeze = Object.freeze;
const streamGetReader = ReadableStream.prototype.getReader;
const streamCancel = ReadableStream.prototype.cancel;
const streamLocked = Object.getOwnPropertyDescriptor(ReadableStream.prototype, "locked")!.get!;
const readerRead = ReadableStreamDefaultReader.prototype.read;
const readerCancel = ReadableStreamDefaultReader.prototype.cancel;
const readerReleaseLock = ReadableStreamDefaultReader.prototype.releaseLock;
const readerClosed = Object.getOwnPropertyDescriptor(
  ReadableStreamDefaultReader.prototype,
  "closed",
)!.get!;

/** Keep private stream consumption independent of replaced Web Streams methods. */
export function getPrivateStreamReader<T>(
  stream: ReadableStream<T>,
): ReadableStreamDefaultReader<T> {
  const reader = apply(streamGetReader, stream, []) as ReadableStreamDefaultReader<T>;
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

const enqueue = ReadableStreamDefaultController.prototype.enqueue;
const close = ReadableStreamDefaultController.prototype.close;
const error = ReadableStreamDefaultController.prototype.error;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;

export const PrivateReadableStream = ReadableStream;

type ControllerOperation = (...args: never[]) => unknown;

function controllerMethod(
  controller: ReadableStreamDefaultController<unknown>,
  key: string,
  native: ControllerOperation,
): ControllerOperation {
  // Internal forwarding controllers provide own methods; native controllers inherit theirs.
  const descriptor = getOwnPropertyDescriptor(controller, key);
  return descriptor && hasOwn(descriptor, "value") && typeof descriptor.value === "function"
    ? descriptor.value
    : native;
}

export function enqueuePrivateStream<T>(controller: ReadableStreamDefaultController<T>, value: T) {
  apply(controllerMethod(controller, "enqueue", enqueue), controller, [value]);
}

export function closePrivateStream(controller: ReadableStreamDefaultController) {
  apply(controllerMethod(controller, "close", close), controller, []);
}

export function errorPrivateStream(controller: ReadableStreamDefaultController, reason: unknown) {
  apply(controllerMethod(controller, "error", error), controller, [reason]);
}
