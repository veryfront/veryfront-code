import { createError, toError } from "#veryfront/errors";
import { types as nodeUtilTypes } from "node:util";

interface ResponseSlotSnapshot {
  readonly type: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly bodyUsed: boolean;
}

export interface SerializedRouteResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Array<[string, string]>;
  readonly body: Uint8Array | null;
}

/** Maximum response body buffered for transfer out of an isolated route worker. */
export const MAX_WORKER_RESPONSE_BODY_BYTES = 10 * 1024 * 1024;
/** Maximum response headers transferred out of an isolated route worker. */
export const MAX_WORKER_RESPONSE_HEADERS = 256;
const MAX_WORKER_RESPONSE_HEADER_CODE_UNITS = 64 * 1024;
const MAX_WORKER_RESPONSE_STATUS_TEXT_CODE_UNITS = 1_024;

/*
 * Capture the Web API primordials before any project handler can mutate its
 * worker/global realm. Every operation below uses these bindings directly:
 * later replacements of Response, Headers, their prototypes, or instance
 * properties cannot redirect validation or serialization into project code.
 */
const NativeResponse = Response;
const NativePromise = Promise;
const NativeUint8Array = Uint8Array;
const NativeArrayBuffer = ArrayBuffer;
const NativeNumber = Number;
const NativeObjectPrototype = Object.prototype;
const apply = Reflect.apply;
const isArray = Array.isArray;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const isInteger = Number.isInteger;
const isSafeInteger = Number.isSafeInteger;
const isPromise = nodeUtilTypes.isPromise;
const isProxy = nodeUtilTypes.isProxy;
const stringToUpperCase = String.prototype.toUpperCase;
const stringCharCodeAt = String.prototype.charCodeAt;
const RESPONSE_STATUS_GETTER = getOwnPropertyDescriptor(
  NativeResponse.prototype,
  "status",
)?.get;
const RESPONSE_STATUS_TEXT_GETTER = getOwnPropertyDescriptor(
  NativeResponse.prototype,
  "statusText",
)?.get;
const RESPONSE_HEADERS_GETTER = getOwnPropertyDescriptor(
  NativeResponse.prototype,
  "headers",
)?.get;
const RESPONSE_BODY_GETTER = getOwnPropertyDescriptor(
  NativeResponse.prototype,
  "body",
)?.get;
const RESPONSE_BODY_USED_GETTER = getOwnPropertyDescriptor(
  NativeResponse.prototype,
  "bodyUsed",
)?.get;
const RESPONSE_TYPE_GETTER = getOwnPropertyDescriptor(
  NativeResponse.prototype,
  "type",
)?.get;
const STREAM_GET_READER = getOwnPropertyDescriptor(
  ReadableStream.prototype,
  "getReader",
)?.value;
const READER_READ = getOwnPropertyDescriptor(
  ReadableStreamDefaultReader.prototype,
  "read",
)?.value;
const READER_CANCEL = getOwnPropertyDescriptor(
  ReadableStreamDefaultReader.prototype,
  "cancel",
)?.value;
const READER_RELEASE_LOCK = getOwnPropertyDescriptor(
  ReadableStreamDefaultReader.prototype,
  "releaseLock",
)?.value;
const HEADERS_FOR_EACH = getOwnPropertyDescriptor(
  Headers.prototype,
  "forEach",
)?.value;
const HEADERS_APPEND = getOwnPropertyDescriptor(
  Headers.prototype,
  "append",
)?.value;
const TYPED_ARRAY_PROTOTYPE = getPrototypeOf(NativeUint8Array.prototype);
const TYPED_ARRAY_BUFFER_GETTER = getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteOffset",
)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = getOwnPropertyDescriptor(
  NativeArrayBuffer.prototype,
  "byteLength",
)?.get;
const TYPED_ARRAY_SET = getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "set",
)?.value;
const PROMISE_CATCH = NativePromise.prototype.catch;
const ARRAY_PUSH = Array.prototype.push;
const isNativeUint8Array = nodeUtilTypes.isUint8Array;

function preventThenableAssimilation<T extends object>(value: T): T {
  defineProperty(value, "then", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  return value;
}

/**
 * Accept only the realm's intrinsic Promise objects from route handlers.
 * Arbitrary thenables and Promise proxies are response candidates, not code
 * execution hooks, and will be rejected by the Response boundary.
 */
export function isTrustedRouteResponsePromise(
  value: unknown,
): value is Promise<unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    !isPromise(value)
  ) {
    return false;
  }

  try {
    return getPrototypeOf(value) === NativePromise.prototype &&
      getOwnPropertyDescriptor(value, "then") === undefined;
  } catch {
    return false;
  }
}

function invalidResponseError(): Error {
  return toError(
    createError({
      type: "api",
      message: "API handler must return a Response",
    }),
  );
}

function responseBodyTooLargeError(actual?: number): Error {
  const measured = actual === undefined ? "declared Content-Length" : `${actual} bytes`;
  return toError(
    createError({
      type: "api",
      message:
        `API response body exceeds the isolated worker transfer limit (${measured}; limit ${MAX_WORKER_RESPONSE_BODY_BYTES} bytes)`,
    }),
  );
}

/**
 * Read Web API Response internal slots through captured platform getters.
 *
 * Calling the native getters with an arbitrary receiver performs the runtime's
 * Response brand check without consulting project-owned properties. Native
 * Responses, including subclasses and objects with an extra prototype layer,
 * retain that brand; plain lookalikes, proxies, and foreign implementations do
 * not.
 */
function snapshotResponseSlots(value: unknown): ResponseSlotSnapshot | null {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    !RESPONSE_TYPE_GETTER ||
    !RESPONSE_STATUS_GETTER ||
    !RESPONSE_STATUS_TEXT_GETTER ||
    !RESPONSE_HEADERS_GETTER ||
    !RESPONSE_BODY_GETTER ||
    !RESPONSE_BODY_USED_GETTER ||
    typeof HEADERS_FOR_EACH !== "function"
  ) {
    return null;
  }

  try {
    const type = apply(RESPONSE_TYPE_GETTER, value, []);
    const status = apply(RESPONSE_STATUS_GETTER, value, []);
    const statusText = apply(RESPONSE_STATUS_TEXT_GETTER, value, []);
    const nativeHeaders = apply(RESPONSE_HEADERS_GETTER, value, []);
    const body = apply(RESPONSE_BODY_GETTER, value, []);
    const bodyUsed = apply(RESPONSE_BODY_USED_GETTER, value, []);

    if (
      typeof type !== "string" ||
      typeof status !== "number" ||
      !isInteger(status) ||
      typeof statusText !== "string" ||
      nativeHeaders === null ||
      typeof nativeHeaders !== "object" ||
      isProxy(nativeHeaders) ||
      (body !== null && typeof body !== "object") ||
      (body !== null && isProxy(body)) ||
      typeof bodyUsed !== "boolean"
    ) {
      return null;
    }

    const headers: Array<readonly [string, string]> = [];
    let invalidHeader = false;
    let headerCodeUnits = 0;
    apply(HEADERS_FOR_EACH, nativeHeaders, [
      (headerValue: unknown, headerName: unknown) => {
        if (
          typeof headerName !== "string" ||
          typeof headerValue !== "string" ||
          headers.length >= MAX_WORKER_RESPONSE_HEADERS
        ) {
          invalidHeader = true;
          return;
        }
        headerCodeUnits += headerName.length + headerValue.length;
        if (headerCodeUnits > MAX_WORKER_RESPONSE_HEADER_CODE_UNITS) {
          invalidHeader = true;
          return;
        }
        headers[headers.length] = [headerName, headerValue];
      },
    ]);
    if (
      invalidHeader ||
      statusText.length > MAX_WORKER_RESPONSE_STATUS_TEXT_CODE_UNITS
    ) {
      return null;
    }

    return {
      type,
      status,
      statusText,
      headers,
      body: body as ReadableStream<Uint8Array> | null,
      bodyUsed,
    };
  } catch {
    return null;
  }
}

function createNativeResponseFromParts(
  status: number,
  statusText: string,
  headers: ReadonlyArray<readonly [string, string]>,
  body: BodyInit | null,
): Response {
  if (!RESPONSE_HEADERS_GETTER || typeof HEADERS_APPEND !== "function") {
    throw invalidResponseError();
  }

  let response: Response;
  try {
    response = new NativeResponse(body, {
      status,
      statusText,
      // Keep the optional member own so a poisoned Object.prototype cannot
      // supply a project-owned HeadersInit to the native constructor.
      headers: undefined,
    });
  } catch {
    throw invalidResponseError();
  }

  try {
    const targetHeaders = apply(RESPONSE_HEADERS_GETTER, response, []);
    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index];
      if (!header) throw invalidResponseError();
      apply(HEADERS_APPEND, targetHeaders, [header[0], header[1]]);
    }
  } catch {
    throw invalidResponseError();
  }

  return preventThenableAssimilation(response);
}

function createNativeResponse(
  snapshot: ResponseSlotSnapshot,
  includeBody: boolean,
): Response {
  if (snapshot.status === 0) {
    // Response.error() is a Fetch-internal network-error sentinel, not an HTTP
    // response: status 0 cannot be serialized by the server wrapper.
    throw invalidResponseError();
  }

  return createNativeResponseFromParts(
    snapshot.status,
    snapshot.statusText,
    snapshot.headers,
    includeBody ? snapshot.body : null,
  );
}

/**
 * Normalize a genuine Response into a framework-owned native Response.
 * Response-shaped objects and constructor lookalikes are rejected.
 */
export function normalizeRouteResponse(value: unknown): Response {
  const snapshot = snapshotResponseSlots(value);
  if (!snapshot) throw invalidResponseError();
  return createNativeResponse(snapshot, true);
}

/** Normalize response metadata for HEAD without consuming or retaining its body. */
export function normalizeRouteHeadResponse(value: unknown): Response {
  const snapshot = snapshotResponseSlots(value);
  if (!snapshot) throw invalidResponseError();
  return createNativeResponse(snapshot, false);
}

/**
 * Snapshot a genuine route Response for worker transfer using captured native
 * methods. HEAD responses never consume the handler's body.
 */
export async function serializeRouteResponse(
  value: unknown,
  requestMethod?: string,
): Promise<SerializedRouteResponse> {
  const snapshot = snapshotResponseSlots(value);
  if (!snapshot) throw invalidResponseError();
  if (snapshot.status === 0) throw invalidResponseError();

  let body: Uint8Array | null = null;
  if (requestMethod !== undefined && typeof requestMethod !== "string") {
    throw invalidResponseError();
  }
  const normalizedMethod = requestMethod === undefined
    ? undefined
    : apply(stringToUpperCase, requestMethod, []);
  if (normalizedMethod !== "HEAD" && snapshot.body !== null) {
    assertDeclaredResponseBodySize(snapshot.headers);
    body = await readBoundedResponseBody(snapshot.body);
  }

  const headers: Array<[string, string]> = [];
  for (let index = 0; index < snapshot.headers.length; index += 1) {
    const header = snapshot.headers[index];
    if (!header) throw invalidResponseError();
    headers[index] = [header[0], header[1]];
  }

  return preventThenableAssimilation({
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers,
    body,
  });
}

function assertDeclaredResponseBodySize(
  headers: ReadonlyArray<readonly [string, string]>,
): void {
  for (let index = 0; index < headers.length; index++) {
    const header = headers[index];
    if (!header || header[0] !== "content-length") continue;
    if (header[1].length === 0) throw invalidResponseError();
    for (let offset = 0; offset < header[1].length; offset++) {
      const code = apply(stringCharCodeAt, header[1], [offset]) as number;
      if (code < 48 || code > 57) throw invalidResponseError();
    }

    const declaredLength = NativeNumber(header[1]);
    if (
      !isSafeInteger(declaredLength) ||
      declaredLength > MAX_WORKER_RESPONSE_BODY_BYTES
    ) {
      throw responseBodyTooLargeError();
    }
    return;
  }
}

function cancelResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  if (typeof READER_CANCEL !== "function") return;
  try {
    const cancellation = apply(READER_CANCEL, reader, []);
    if (isPromise(cancellation)) {
      apply(PROMISE_CATCH, cancellation, [() => undefined]);
    }
  } catch {
    // Cancellation is best effort after the primary response failure is known.
  }
}

async function readBoundedResponseBody(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  if (
    typeof STREAM_GET_READER !== "function" ||
    typeof READER_READ !== "function" ||
    typeof READER_RELEASE_LOCK !== "function" ||
    typeof TYPED_ARRAY_SET !== "function" ||
    typeof TYPED_ARRAY_BYTE_LENGTH_GETTER !== "function"
  ) {
    throw invalidResponseError();
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = apply(STREAM_GET_READER, stream, []) as ReadableStreamDefaultReader<Uint8Array>;
  } catch {
    throw invalidResponseError();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await apply(READER_READ, reader, []) as ReadableStreamReadResult<Uint8Array>;
      } catch {
        cancelResponseReader(reader);
        throw invalidResponseError();
      }
      if (result === null || typeof result !== "object" || isProxy(result)) {
        cancelResponseReader(reader);
        throw invalidResponseError();
      }

      const done = getOwnPropertyDescriptor(result, "done");
      const value = getOwnPropertyDescriptor(result, "value");
      if (!done || !("value" in done) || typeof done.value !== "boolean") {
        cancelResponseReader(reader);
        throw invalidResponseError();
      }
      if (done.value) break;

      const chunk = value && "value" in value ? value.value : undefined;
      if (!isNativeUint8Array(chunk) || isProxy(chunk)) {
        cancelResponseReader(reader);
        throw invalidResponseError();
      }
      const chunkByteLength = apply(TYPED_ARRAY_BYTE_LENGTH_GETTER!, chunk, []) as number;
      if (chunkByteLength > MAX_WORKER_RESPONSE_BODY_BYTES - totalBytes) {
        cancelResponseReader(reader);
        throw responseBodyTooLargeError(totalBytes + chunkByteLength);
      }

      apply(ARRAY_PUSH, chunks, [chunk]);
      totalBytes += chunkByteLength;
    }
  } finally {
    try {
      apply(READER_RELEASE_LOCK, reader, []);
    } catch {
      // The response outcome is already determined.
    }
  }

  const body = new NativeUint8Array(totalBytes);
  let offset = 0;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!;
    apply(TYPED_ARRAY_SET, body, [chunk, offset]);
    offset += apply(TYPED_ARRAY_BYTE_LENGTH_GETTER!, chunk, []) as number;
  }
  return body;
}

const INVALID_SERIALIZED_FIELD = Symbol("invalid-serialized-field");

function readOwnDataField(
  value: object,
  key: PropertyKey,
): unknown | typeof INVALID_SERIALIZED_FIELD {
  try {
    const descriptor = getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : INVALID_SERIALIZED_FIELD;
  } catch {
    return INVALID_SERIALIZED_FIELD;
  }
}

function snapshotSerializedHeaders(
  value: unknown,
): Array<readonly [string, string]> | null {
  if (!isArray(value) || isProxy(value)) return null;
  if (value.length > MAX_WORKER_RESPONSE_HEADERS) return null;

  const headers: Array<readonly [string, string]> = [];
  let headerCodeUnits = 0;
  for (let index = 0; index < value.length; index += 1) {
    const pair = readOwnDataField(value, index);
    if (!isArray(pair) || isProxy(pair) || pair.length !== 2) return null;

    const name = readOwnDataField(pair, 0);
    const headerValue = readOwnDataField(pair, 1);
    if (typeof name !== "string" || typeof headerValue !== "string") {
      return null;
    }
    headerCodeUnits += name.length + headerValue.length;
    if (headerCodeUnits > MAX_WORKER_RESPONSE_HEADER_CODE_UNITS) return null;
    headers[index] = [name, headerValue];
  }
  return headers;
}

function snapshotSerializedBody(
  value: unknown,
): Uint8Array<ArrayBuffer> | null | typeof INVALID_SERIALIZED_FIELD {
  if (value === null) return null;
  if (
    typeof value !== "object" ||
    isProxy(value) ||
    getPrototypeOf(value) !== NativeUint8Array.prototype ||
    !TYPED_ARRAY_BUFFER_GETTER ||
    !TYPED_ARRAY_BYTE_LENGTH_GETTER ||
    !TYPED_ARRAY_BYTE_OFFSET_GETTER ||
    !ARRAY_BUFFER_BYTE_LENGTH_GETTER
  ) {
    return INVALID_SERIALIZED_FIELD;
  }

  try {
    const buffer = apply(TYPED_ARRAY_BUFFER_GETTER, value, []);
    const byteLength = apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
    const byteOffset = apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []);
    apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
    if (
      buffer === null ||
      typeof buffer !== "object" ||
      isProxy(buffer) ||
      typeof byteLength !== "number" ||
      typeof byteOffset !== "number" ||
      byteLength > MAX_WORKER_RESPONSE_BODY_BYTES
    ) {
      return INVALID_SERIALIZED_FIELD;
    }
    return new NativeUint8Array(buffer as ArrayBuffer, byteOffset, byteLength);
  } catch {
    return INVALID_SERIALIZED_FIELD;
  }
}

/**
 * Reconstruct a worker-transferred response after validating its data-only
 * shape. Status zero is rejected because it is not serializable over HTTP.
 */
export function deserializeRouteResponse(value: unknown): Response {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value)
  ) {
    throw invalidResponseError();
  }

  try {
    const prototype = getPrototypeOf(value);
    if (prototype !== NativeObjectPrototype && prototype !== null) {
      throw invalidResponseError();
    }
  } catch {
    throw invalidResponseError();
  }

  const status = readOwnDataField(value, "status");
  const statusText = readOwnDataField(value, "statusText");
  const headers = snapshotSerializedHeaders(readOwnDataField(value, "headers"));
  const body = snapshotSerializedBody(readOwnDataField(value, "body"));
  if (
    typeof status !== "number" ||
    !isInteger(status) ||
    typeof statusText !== "string" ||
    statusText.length > MAX_WORKER_RESPONSE_STATUS_TEXT_CODE_UNITS ||
    headers === null ||
    body === INVALID_SERIALIZED_FIELD
  ) {
    throw invalidResponseError();
  }

  if (status === 0) {
    throw invalidResponseError();
  }

  return createNativeResponseFromParts(status, statusText, headers, body);
}
