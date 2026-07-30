import { INVALID_ARGUMENT } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { assertSafeBlobId } from "./blob-id.ts";
import type { StoreBlobOptions } from "./types.ts";

/** Maximum media-type length accepted by every blob backend. */
export const MAX_BLOB_MIME_TYPE_CODE_UNITS = 255;
/** Maximum number of user metadata entries accepted by every blob backend. */
export const MAX_BLOB_METADATA_ENTRIES = 64;
/** Maximum user metadata key length accepted by every blob backend. */
export const MAX_BLOB_METADATA_KEY_CODE_UNITS = 128;
/** Maximum individual user metadata value length accepted by every blob backend. */
export const MAX_BLOB_METADATA_VALUE_CODE_UNITS = 4_096;
/** Maximum combined metadata key/value length accepted by every blob backend. */
export const MAX_BLOB_METADATA_TOTAL_CODE_UNITS = 16_384;
/** Maximum payload buffered by a built-in blob backend. */
export const MAX_BLOB_BUFFER_BYTES = 64 * 1024 * 1024;
/** Maximum chunks accepted while buffering a stream, including empty chunks. */
export const MAX_BLOB_STREAM_CHUNKS = 65_536;

const STORE_BLOB_OPTION_KEYS = new Set(["id", "mimeType", "metadata", "ttl"]);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const blobSizeGetter = Object.getOwnPropertyDescriptor(Blob.prototype, "size")?.get;
const blobArrayBuffer = Blob.prototype.arrayBuffer;
const streamLockedGetter = Object.getOwnPropertyDescriptor(
  ReadableStream.prototype,
  "locked",
)?.get;
const streamGetReader = ReadableStream.prototype.getReader;
const readerRead = ReadableStreamDefaultReader.prototype.read;
const readerCancel = ReadableStreamDefaultReader.prototype.cancel;
const readerReleaseLock = ReadableStreamDefaultReader.prototype.releaseLock;

export interface CapturedStoreBlobOptions {
  readonly id?: string;
  readonly mimeType?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly ttl?: number;
}

/** Return whether text contains ASCII control code units unsafe in headers or paths. */
export function hasBlobControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function fail(detail: string, cause?: unknown): never {
  throw INVALID_ARGUMENT.create({ detail, ...(cause === undefined ? {} : { cause }) });
}

function assertPlainRecord(value: object, label: string): void {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch (cause) {
    fail(`${label} could not be inspected`, cause);
  }
  if (prototype === null) return;
  if (isProxyWithoutHooks(prototype)) fail(`${label} must not inherit from a Proxy`);

  let parent: object | null;
  try {
    parent = Object.getPrototypeOf(prototype) as object | null;
  } catch (cause) {
    fail(`${label} prototype could not be inspected`, cause);
  }
  if (parent !== null) fail(`${label} must be a plain record`);
}

/**
 * Capture an exact public record without evaluating accessors or Proxy traps.
 * The returned map contains only own enumerable data-property values.
 */
export function captureExactBlobRecord(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
): ReadonlyMap<string, unknown> {
  if (
    typeof value !== "object" || value === null || isProxyWithoutHooks(value) ||
    Array.isArray(value)
  ) {
    fail(`${label} must be a non-Proxy plain record`);
  }
  assertPlainRecord(value, label);

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    fail(`${label} could not be inspected`, cause);
  }
  if (keys.length > allowedKeys.size) fail(`${label} contains unsupported fields`);

  const fields = new Map<string, unknown>();
  for (const key of keys) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      fail(
        `${label} contains unsupported ${
          typeof key === "string" ? `field "${key}"` : "symbol field"
        }`,
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (cause) {
      fail(`${label} field "${key}" could not be inspected`, cause);
    }
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
      fail(`${label} field "${key}" must be an enumerable own data property`);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

/** Capture bounded string metadata without invoking caller-owned hooks. */
export function captureBlobMetadata(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object" || value === null || isProxyWithoutHooks(value) ||
    Array.isArray(value)
  ) {
    fail("Blob metadata must be a non-Proxy plain record of strings");
  }
  assertPlainRecord(value, "Blob metadata");

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    fail("Blob metadata could not be inspected", cause);
  }
  if (keys.length > MAX_BLOB_METADATA_ENTRIES) {
    fail(`Blob metadata cannot contain more than ${MAX_BLOB_METADATA_ENTRIES} entries`);
  }

  let totalCodeUnits = 0;
  const metadata = Object.create(null) as Record<string, string>;
  for (const key of keys) {
    if (typeof key !== "string") fail("Blob metadata cannot contain symbol keys");
    if (key.length === 0 || key.length > MAX_BLOB_METADATA_KEY_CODE_UNITS) {
      fail(
        `Blob metadata keys must contain 1-${MAX_BLOB_METADATA_KEY_CODE_UNITS} code units`,
      );
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (cause) {
      fail(`Blob metadata field "${key}" could not be inspected`, cause);
    }
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
      fail(`Blob metadata field "${key}" must be an enumerable own data property`);
    }
    if (typeof descriptor.value !== "string") {
      fail("Blob metadata values must be strings");
    }
    if (descriptor.value.length > MAX_BLOB_METADATA_VALUE_CODE_UNITS) {
      fail(
        `Blob metadata values cannot exceed ${MAX_BLOB_METADATA_VALUE_CODE_UNITS} code units`,
      );
    }
    totalCodeUnits += key.length + descriptor.value.length;
    if (totalCodeUnits > MAX_BLOB_METADATA_TOTAL_CODE_UNITS) {
      fail(
        `Blob metadata cannot exceed ${MAX_BLOB_METADATA_TOTAL_CODE_UNITS} total code units`,
      );
    }
    Object.defineProperty(metadata, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(metadata);
}

/** Validate and snapshot one media type consistently across all backends. */
export function captureBlobMimeType(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_BLOB_MIME_TYPE_CODE_UNITS || value.trim() !== value ||
    hasBlobControlCharacters(value)
  ) {
    fail(
      `Blob mimeType must be a non-empty string of at most ${MAX_BLOB_MIME_TYPE_CODE_UNITS} code units with no surrounding whitespace or control characters`,
    );
  }
  return value;
}

function captureBlobTtl(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("Blob TTL must be a non-negative safe integer");
  }
  return value;
}

/** Capture blob put options before any filesystem or network operation starts. */
export function captureStoreBlobOptions(value: unknown): CapturedStoreBlobOptions {
  if (value === undefined) return Object.freeze({});
  const fields = captureExactBlobRecord(value, "Blob store options", STORE_BLOB_OPTION_KEYS);
  const id = fields.get("id");
  if (id !== undefined) assertSafeBlobId(id);
  const mimeType = fields.get("mimeType");
  const capturedMimeType = mimeType === undefined ? undefined : captureBlobMimeType(mimeType);
  const metadata = captureBlobMetadata(fields.get("metadata"));
  const ttl = captureBlobTtl(fields.get("ttl"));
  return Object.freeze({
    ...(id === undefined ? {} : { id }),
    ...(capturedMimeType === undefined ? {} : { mimeType: capturedMimeType }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(ttl === undefined ? {} : { ttl }),
  }) as CapturedStoreBlobOptions;
}

function utf8ByteLength(value: string, maxBytes: number): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > maxBytes) return bytes;
  }
  return bytes;
}

function assertBufferSize(size: number, maxBytes: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
    fail(`Blob payload cannot exceed ${maxBytes} buffered bytes`);
  }
}

function getUint8ArrayByteLength(value: unknown): number | null {
  if (!typedArrayByteLengthGetter || typeof value !== "object" || value === null) return null;
  try {
    return Reflect.apply(typedArrayByteLengthGetter, value, []) as number;
  } catch {
    return null;
  }
}

function copyUint8Array(
  value: unknown,
  maxBytes: number,
): Uint8Array<ArrayBuffer> | null {
  const byteLength = getUint8ArrayByteLength(value);
  if (byteLength === null) return null;
  assertBufferSize(byteLength, maxBytes);
  const copy = new Uint8Array(byteLength);
  Reflect.apply(Uint8Array.prototype.set, copy, [value]);
  return copy;
}

function getBlobSize(value: unknown): number | null {
  if (!blobSizeGetter || typeof value !== "object" || value === null) return null;
  try {
    return Reflect.apply(blobSizeGetter, value, []) as number;
  } catch {
    return null;
  }
}

function isReadableStream(value: unknown): boolean {
  if (!streamLockedGetter || typeof value !== "object" || value === null) return false;
  try {
    Reflect.apply(streamLockedGetter, value, []);
    return true;
  } catch {
    return false;
  }
}

async function cancelReaderAndThrow(
  reader: ReadableStreamDefaultReader<unknown>,
  error: Error,
): Promise<never> {
  try {
    await Reflect.apply(readerCancel, reader, [error]);
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      "Blob stream rejection and cancellation both failed",
    );
  }
  throw error;
}

async function bufferReadableStream(
  value: object,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  let reader: ReadableStreamDefaultReader<unknown>;
  try {
    reader = Reflect.apply(streamGetReader, value, []) as ReadableStreamDefaultReader<unknown>;
  } catch (cause) {
    return fail("Blob ReadableStream must be unlocked", cause);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let chunkCount = 0;
  try {
    while (true) {
      const result = await Reflect.apply(readerRead, reader, []) as ReadableStreamReadResult<
        unknown
      >;
      if (result.done) break;
      chunkCount++;
      if (chunkCount > MAX_BLOB_STREAM_CHUNKS) {
        const error = INVALID_ARGUMENT.create({
          detail: `Blob ReadableStream cannot exceed ${MAX_BLOB_STREAM_CHUNKS} chunks`,
        });
        await cancelReaderAndThrow(reader, error);
      }
      if (isProxyWithoutHooks(result.value)) {
        await cancelReaderAndThrow(
          reader,
          INVALID_ARGUMENT.create({
            detail: "Blob ReadableStream chunks must be non-Proxy Uint8Array values",
          }),
        );
      }
      const chunkByteLength = getUint8ArrayByteLength(result.value);
      if (chunkByteLength === null) {
        return await cancelReaderAndThrow(
          reader,
          INVALID_ARGUMENT.create({
            detail: "Blob ReadableStream chunks must be Uint8Array values",
          }),
        );
      }
      const nextTotalBytes = totalBytes + chunkByteLength;
      if (!Number.isSafeInteger(nextTotalBytes) || nextTotalBytes > maxBytes) {
        const error = INVALID_ARGUMENT.create({
          detail: `Blob payload cannot exceed ${maxBytes} buffered bytes`,
        });
        await cancelReaderAndThrow(reader, error);
      }
      const chunk = copyUint8Array(result.value, maxBytes)!;
      totalBytes = nextTotalBytes;
      chunks.push(chunk);
    }
  } finally {
    Reflect.apply(readerReleaseLock, reader, []);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Buffer and detach one supported payload under a shared, explicit ceiling. */
export async function captureBlobBytes(
  value: unknown,
  maxBytes = MAX_BLOB_BUFFER_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_BLOB_BUFFER_BYTES) {
    return fail(
      `Blob buffer ceiling must be an integer between 1 and ${MAX_BLOB_BUFFER_BYTES} bytes`,
    );
  }
  if (typeof value === "string") {
    assertBufferSize(utf8ByteLength(value, maxBytes), maxBytes);
    return new TextEncoder().encode(value);
  }
  if (typeof value !== "object" || value === null || isProxyWithoutHooks(value)) {
    return fail("Blob payload must be a non-Proxy string, Uint8Array, Blob, or ReadableStream");
  }

  const bytes = copyUint8Array(value, maxBytes);
  if (bytes) return bytes;

  const blobSize = getBlobSize(value);
  if (blobSize !== null) {
    assertBufferSize(blobSize, maxBytes);
    let buffer: ArrayBuffer;
    try {
      buffer = await Reflect.apply(blobArrayBuffer, value, []) as ArrayBuffer;
    } catch (cause) {
      return fail("Blob payload could not be buffered", cause);
    }
    assertBufferSize(buffer.byteLength, maxBytes);
    return new Uint8Array(buffer);
  }

  if (isReadableStream(value)) return await bufferReadableStream(value, maxBytes);
  return fail("Blob payload must be a string, Uint8Array, Blob, or ReadableStream");
}

/** Convert a captured readonly metadata snapshot into a detached public record. */
export function copyCapturedBlobMetadata(
  value: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const copy = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(value)) copy[key] = value[key]!;
  return copy;
}

/** Type-level compatibility check for the public options contract. */
const _storeBlobOptionsCompatibility: CapturedStoreBlobOptions = {} satisfies StoreBlobOptions;
void _storeBlobOptionsCompatibility;
