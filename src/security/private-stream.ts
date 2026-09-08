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
