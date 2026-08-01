/**
 * Minimal handle contract shared by native filesystem adapters.
 *
 * The caller supplies the handle factory so each runtime can choose its native
 * open semantics while this helper owns bounded chunking and cleanup.
 */
export interface BoundedFileReader {
  read(buffer: Uint8Array): Promise<number | null>;
}

export interface BoundedFileReadHandle extends BoundedFileReader {
  close(): void | Promise<void>;
}

const apply = Reflect.apply;
const arrayPush = Array.prototype.push;
const minimum = Math.min;
const numberIsSafeInteger = Number.isSafeInteger;
const NativeUint8Array = Uint8Array;
const typedArrayPrototype = Object.getPrototypeOf(NativeUint8Array.prototype);
const typedArrayByteLengthGetterCandidate = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayBufferGetterCandidate = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)?.get;
const typedArrayByteOffsetGetterCandidate = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
)?.get;
const setBytes = NativeUint8Array.prototype.set;

if (
  typeof typedArrayByteLengthGetterCandidate !== "function" ||
  typeof typedArrayBufferGetterCandidate !== "function" ||
  typeof typedArrayByteOffsetGetterCandidate !== "function"
) {
  throw new TypeError("Required Uint8Array intrinsics are unavailable");
}
const typedArrayByteLengthGetter = typedArrayByteLengthGetterCandidate;
const typedArrayBufferGetter = typedArrayBufferGetterCandidate;
const typedArrayByteOffsetGetter = typedArrayByteOffsetGetterCandidate;

function byteLengthOf(value: Uint8Array): number {
  const byteLength = apply(typedArrayByteLengthGetter, value, []);
  if (!numberIsSafeInteger(byteLength) || (byteLength as number) < 0) {
    throw new TypeError("Filesystem read buffer has an invalid byte length");
  }
  return byteLength as number;
}

function allocateBytes(byteLength: number): Uint8Array {
  const bytes = new NativeUint8Array(byteLength);
  if (byteLengthOf(bytes) !== byteLength) {
    throw new TypeError("Filesystem byte buffer allocation returned an invalid size");
  }
  return bytes;
}

function viewBytes(value: Uint8Array, start: number, byteLength: number): Uint8Array {
  const sourceByteLength = byteLengthOf(value);
  if (
    !numberIsSafeInteger(start) || start < 0 ||
    !numberIsSafeInteger(byteLength) || byteLength < 0 ||
    start > sourceByteLength - byteLength
  ) {
    throw new RangeError("Filesystem byte view is outside its source buffer");
  }
  const buffer = apply(typedArrayBufferGetter, value, []) as ArrayBuffer;
  const byteOffset = apply(typedArrayByteOffsetGetter, value, []) as number;
  const view = new NativeUint8Array(buffer, byteOffset + start, byteLength);
  if (byteLengthOf(view) !== byteLength) {
    throw new TypeError("Filesystem byte view allocation returned an invalid size");
  }
  return view;
}

// Keep a large caller-supplied limit from becoming an equally large eager
// allocation when the source is small. The aggregate returned data remains
// bounded by the caller's limit.
const BOUNDED_FILE_READ_CHUNK_BYTES = 64 * 1024;

async function readAndCloseHandle<T>(
  openHandle: () => Promise<BoundedFileReadHandle>,
  read: (handle: BoundedFileReadHandle) => Promise<T>,
): Promise<T> {
  const handle = await openHandle();
  let result: T | undefined;
  let primaryFailure: unknown;
  let primaryFailed = false;
  try {
    result = await read(handle);
  } catch (error) {
    primaryFailed = true;
    primaryFailure = error;
  }

  try {
    await handle.close();
  } catch (cleanupFailure) {
    if (primaryFailed) {
      throw new AggregateError(
        [primaryFailure, cleanupFailure],
        "Filesystem read and handle cleanup both failed",
      );
    }
    throw cleanupFailure;
  }

  if (primaryFailed) throw primaryFailure;
  return result as T;
}

export function requireBoundedFileReadLimit(byteLimit: unknown): number {
  if (!numberIsSafeInteger(byteLimit) || (byteLimit as number) <= 0) {
    throw new RangeError("Filesystem byteLimit must be a positive safe integer");
  }
  return byteLimit as number;
}

/**
 * Read at most `byteLimit` bytes without first materializing the whole file.
 *
 * A full-length result is intentionally ambiguous: callers that need to
 * distinguish an exact-size file from an oversized file request their accepted
 * maximum plus one byte.
 */
export async function readBoundedFilePrefix(
  openHandle: () => Promise<BoundedFileReadHandle>,
  byteLimit: number,
): Promise<Uint8Array> {
  const boundedLimit = requireBoundedFileReadLimit(byteLimit);
  return await readAndCloseHandle(
    openHandle,
    (handle) => readBoundedFileHandlePrefix(handle, boundedLimit),
  );
}

/**
 * Read the complete file only when it fits within `byteLimit`.
 *
 * Unlike a prefix read, reaching the limit triggers one additional EOF probe.
 * The probe reuses the final byte of the accepted buffer, so the helper never
 * retains more than `byteLimit` bytes from the source.
 */
export async function readFileWithinLimit(
  openHandle: () => Promise<BoundedFileReadHandle>,
  byteLimit: number,
): Promise<Uint8Array> {
  const boundedLimit = requireBoundedFileReadLimit(byteLimit);
  return await readAndCloseHandle(
    openHandle,
    (handle) => readFileHandleWithinLimit(handle, boundedLimit),
  );
}

/** Read a bounded prefix while leaving ownership of the open handle to the caller. */
export async function readBoundedFileHandlePrefix(
  reader: BoundedFileReader,
  byteLimit: number,
): Promise<Uint8Array> {
  const boundedLimit = requireBoundedFileReadLimit(byteLimit);
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let reachedEnd = false;
  while (byteLength < boundedLimit) {
    const chunk = allocateBytes(
      minimum(BOUNDED_FILE_READ_CHUNK_BYTES, boundedLimit - byteLength),
    );
    let chunkLength = 0;
    const chunkByteLength = byteLengthOf(chunk);
    while (chunkLength < chunkByteLength) {
      const remaining = viewBytes(chunk, chunkLength, chunkByteLength - chunkLength);
      const bytesRead = await reader.read(remaining);
      if (bytesRead === null || bytesRead === 0) {
        reachedEnd = true;
        break;
      }
      if (
        !numberIsSafeInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > byteLengthOf(remaining)
      ) {
        throw new TypeError("Filesystem read returned an invalid byte count");
      }
      chunkLength += bytesRead;
      byteLength += bytesRead;
    }
    if (chunkLength > 0) {
      // Copy a short final chunk so a tiny result does not retain the entire
      // fixed-size read buffer.
      if (chunkLength === chunkByteLength) {
        apply(arrayPush, chunks, [chunk]);
      } else {
        const shortChunk = allocateBytes(chunkLength);
        apply(setBytes, shortChunk, [viewBytes(chunk, 0, chunkLength)]);
        apply(arrayPush, chunks, [shortChunk]);
      }
    }
    if (reachedEnd) break;
  }

  if (chunks.length === 0) return allocateBytes(0);
  if (chunks.length === 1) return chunks[0]!;
  const bytes = allocateBytes(byteLength);
  let offset = 0;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!;
    apply(setBytes, bytes, [chunk, offset]);
    offset += byteLengthOf(chunk);
  }
  return bytes;
}

/** Read a complete bounded file while leaving ownership of the handle to the caller. */
export async function readFileHandleWithinLimit(
  reader: BoundedFileReader,
  byteLimit: number,
): Promise<Uint8Array> {
  const boundedLimit = requireBoundedFileReadLimit(byteLimit);
  const bytes = await readBoundedFileHandlePrefix(reader, boundedLimit);
  if (byteLengthOf(bytes) < boundedLimit) return bytes;

  // Reuse the final accepted byte as the EOF probe instead of allocating or
  // retaining a maximum-plus-one buffer. Restore it when the file ends exactly
  // at the limit; on overflow the result is discarded.
  const finalIndex = boundedLimit - 1;
  const acceptedFinalByte = bytes[finalIndex]!;
  const probe = viewBytes(bytes, finalIndex, 1);
  const bytesRead = await reader.read(probe);
  if (bytesRead === null || bytesRead === 0) {
    bytes[finalIndex] = acceptedFinalByte;
    return bytes;
  }
  if (!numberIsSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > byteLengthOf(probe)) {
    throw new TypeError("Filesystem read returned an invalid byte count");
  }

  throw new RangeError(
    `File exceeds byte limit of ${boundedLimit} ${boundedLimit === 1 ? "byte" : "bytes"}`,
  );
}
