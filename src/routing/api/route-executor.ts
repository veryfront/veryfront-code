import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createContext, normalizeParams, parseCookies } from "./context-builder.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import { createError, errorToRFC9457Response, NOT_SUPPORTED, toError } from "#veryfront/errors";
import {
  detachThrowableForBoundary,
  snapshotThrowableDiagnostic,
} from "#veryfront/errors/safe-diagnostics.ts";
import type {
  APIRoute,
  AppRouteContext,
  AppRouteHandler,
  PagesRouteHandler,
} from "./module-loader/types.ts";
import {
  createAppRouteMethodNotAllowed,
  createPagesRouteMethodNotAllowed,
} from "./method-validator.ts";
import { isAbsolute, join } from "#veryfront/compat/path/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger as logger } from "#veryfront/utils";
import type { HandlerContext } from "#veryfront/types";
import { getWorkerPool, isHostRealmApiExecution } from "#veryfront/security/sandbox/worker-pool.ts";
import {
  resolveWorkerGeneration,
  snapshotWorkerGenerationIdentity,
} from "#veryfront/security/sandbox/worker-generation.ts";
import { deserializeWorkerError } from "#veryfront/security/sandbox/worker-error-boundary.ts";
import {
  MAX_WORKER_BODY_BYTES,
  type PreparedWorkerModule,
  type SerializedRequest,
  type SerializedResponse,
  type WorkerResponse,
  type WorkerRouteMethodsResponse,
} from "#veryfront/security/sandbox/worker-types.ts";
import { requireActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import {
  normalizeRouteMethod,
  resolveRouteHandlerExport,
  STANDARD_ROUTE_METHODS,
} from "./route-methods.ts";
import {
  deserializeRouteResponse,
  isTrustedRouteResponsePromise,
  normalizeRouteHeadResponse,
  normalizeRouteResponse,
} from "./response-normalization.ts";
import { types as nodeUtilTypes } from "node:util";
import { getTrustedProjectEnvSnapshot } from "#veryfront/platform/compat/process/env.ts";
import {
  PROJECT_ENV_SNAPSHOT_LIMITS,
  type ProjectEnvSnapshot,
} from "#veryfront/platform/compat/process/project-env-contract.ts";
import {
  isExplicitHostProjectCodeExecutionAllowed,
  isExplicitlyLocalProject,
  readOwnDataProperty,
} from "#veryfront/security/project-locality.ts";
import { isInfrastructureOnlyRequestHeader } from "#veryfront/security/http/application-request.ts";
import type { ApplicationIdentity } from "#veryfront/security/application-auth/types.ts";
import { snapshotApplicationIdentity } from "#veryfront/security/application-auth/identity.ts";

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectKeys = Object.keys;
const objectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ownKeys = Reflect.ownKeys;
const objectPrototype = Object.prototype;
const EMPTY_PROJECT_ENV = objectFreeze(
  objectCreate(null) as Record<string, string>,
);
const numberIsSafeInteger = Number.isSafeInteger;
const NativePromise = Promise;
const promiseResolve = NativePromise.resolve;
const promiseReject = NativePromise.reject;
const promiseThen = NativePromise.prototype.then;
const NativeRequest = Request;
const NativeUint8Array = Uint8Array;
const NativeNumber = Number;
const NativeTextEncoder = TextEncoder;
const semanticTextEncoder = new NativeTextEncoder();
const textEncoderEncode = NativeTextEncoder.prototype.encode;
const nativeCrypto = crypto;
const nativeSubtleCrypto = nativeCrypto.subtle;
const subtleDigest = nativeSubtleCrypto.digest;
const requestUrlGetter = getOwnPropertyDescriptor(NativeRequest.prototype, "url")!.get!;
const requestMethodGetter = getOwnPropertyDescriptor(NativeRequest.prototype, "method")!.get!;
const requestHeadersGetter = getOwnPropertyDescriptor(NativeRequest.prototype, "headers")!.get!;
const requestBodyGetter = getOwnPropertyDescriptor(NativeRequest.prototype, "body")!.get!;
const requestSignalGetter = getOwnPropertyDescriptor(NativeRequest.prototype, "signal")!.get!;
const headersGet = Headers.prototype.get;
const headersForEach = Headers.prototype.forEach;
const abortSignalAbortedGetter = getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)!.get!;
const eventTargetAddEventListener = EventTarget.prototype.addEventListener;
const eventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;
const streamGetReader = ReadableStream.prototype.getReader;
const streamCancel = ReadableStream.prototype.cancel;
const readerRead = ReadableStreamDefaultReader.prototype.read;
const readerCancel = ReadableStreamDefaultReader.prototype.cancel;
const readerReleaseLock = ReadableStreamDefaultReader.prototype.releaseLock;
const typedArrayPrototype = Object.getPrototypeOf(NativeUint8Array.prototype);
const typedArrayByteLengthGetter = getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)!.get!;
const typedArrayBufferGetter = getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)!.get!;
const typedArrayByteOffsetGetter = getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
)!.get!;
const typedArraySet = getOwnPropertyDescriptor(typedArrayPrototype, "set")!.value as (
  source: ArrayLike<number>,
  offset?: number,
) => void;
const arrayPush = Array.prototype.push;
const arrayIncludes = Array.prototype.includes;
const arraySort = Array.prototype.sort;
const arrayJoin = Array.prototype.join;
const arrayIsArray = Array.isArray;
const cryptoRandomUUID = nativeCrypto.randomUUID;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringSlice = String.prototype.slice;
const stringToUpperCase = String.prototype.toUpperCase;
const stringPadStart = String.prototype.padStart;
const numberToString = Number.prototype.toString;
const regexpTest = RegExp.prototype.test;
const isNativeUint8Array = nodeUtilTypes.isUint8Array;
const isNativeProxy = nodeUtilTypes.isProxy;
const CONTENT_LENGTH_PATTERN = /^\d+$/;
const PROJECT_ENV_KEY_PATTERN = /^[^=\0]+$/;
const PROJECT_ENV_VALUE_PATTERN = /^[^\0]*$/;
const MAX_WORKER_BODY_BYTES_DECIMAL = `${MAX_WORKER_BODY_BYTES}`;
const BODY_COALESCE_BLOCK_BYTES = 64 * 1024;
const BODY_READ_YIELD_CHUNKS = 256;
const MAX_WORKER_BODY_SOURCE_CHUNKS = 16_384;
const MAX_CONSECUTIVE_EMPTY_BODY_CHUNKS = 4_096;
const nativeSetTimeout = setTimeout;

function resolvePromise<T>(value: T): Promise<Awaited<T>> {
  return apply(promiseResolve, NativePromise, [value]) as Promise<Awaited<T>>;
}

function getRequestUrl(request: Request): string {
  return apply(requestUrlGetter, request, []) as string;
}

function getRequestMethod(request: Request): string {
  return apply(requestMethodGetter, request, []) as string;
}

function getRequestHeaders(request: Request): Headers {
  return apply(requestHeadersGetter, request, []) as Headers;
}

function getRequestBody(request: Request): ReadableStream<Uint8Array> | null {
  return apply(requestBodyGetter, request, []) as ReadableStream<Uint8Array> | null;
}

function getRequestSignal(request: Request): AbortSignal {
  return apply(requestSignalGetter, request, []) as AbortSignal;
}

function getHeader(headers: Headers, name: string): string | null {
  return apply(headersGet, headers, [name]) as string | null;
}

function snapshotHeaders(
  headers: Headers,
): [string, string][] {
  const result: [string, string][] = [];
  apply(headersForEach, headers, [
    (value: string, name: string) => {
      if (isInfrastructureOnlyRequestHeader(name)) return;
      apply(arrayPush, result, [[name, value]]);
    },
  ]);
  return result;
}

function uppercaseMethod(method: string): string {
  return apply(stringToUpperCase, method, []) as string;
}

function randomUUID(): string {
  return apply(cryptoRandomUUID, nativeCrypto, []) as string;
}

function findSerializedHeader(
  headers: readonly [string, string][],
  expectedName: string,
): string | null {
  for (let index = 0; index < headers.length; index++) {
    const entry = headers[index]!;
    if (entry[0] === expectedName) return entry[1];
  }
  return null;
}

/**
 * Read the current project env snapshot via the closure bridge registered by
 * server/project-env/storage.ts.  This avoids a direct import from the server/
 * layer (which would violate the layer architecture).
 */
function getProjectEnvSnapshot(): ProjectEnvSnapshot | undefined {
  return getTrustedProjectEnvSnapshot();
}

function encodeSemanticMaterial(value: string): Uint8Array {
  return apply(textEncoderEncode, semanticTextEncoder, [value]) as Uint8Array;
}

function semanticByteLength(value: string): number {
  return apply(typedArrayByteLengthGetter, encodeSemanticMaterial(value), []) as number;
}

function appendSemanticPart(parts: string[], value: string): void {
  objectDefineProperty(parts, parts.length, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function appendFramed(parts: string[], value: string): void {
  const length = apply(numberToString, value.length, [10]) as string;
  appendSemanticPart(parts, `${length}:${value}`);
}

function snapshotProjectEnvRecordForWorker(
  raw: unknown,
): ProjectEnvSnapshot | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null) {
    throw createRequestBodyReadError("Project environment snapshot must be a plain data record");
  }

  const descriptors = getDataDescriptors(raw);
  if (!descriptors) {
    throw createRequestBodyReadError("Project environment snapshot must be a plain data record");
  }

  const reflectedKeys = ownKeys(raw);
  const keys = objectKeys(descriptors);
  if (
    reflectedKeys.length !== keys.length ||
    keys.length > PROJECT_ENV_SNAPSHOT_LIMITS.maxEntries
  ) {
    throw createRequestBodyReadError("Project environment snapshot is invalid or too large");
  }
  apply(arraySort, keys, []);

  const output = objectCreate(null) as Record<string, string>;
  let totalBytes = 0;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = descriptors[key];
    const hasValue = descriptor !== undefined &&
      apply(objectPrototypeHasOwnProperty, descriptor, ["value"]) === true;
    const value = hasValue ? descriptor.value : undefined;
    if (
      descriptor?.enumerable !== true ||
      typeof value !== "string" ||
      key.length > PROJECT_ENV_SNAPSHOT_LIMITS.maxKeyChars ||
      value.length > PROJECT_ENV_SNAPSHOT_LIMITS.maxValueChars ||
      !apply(regexpTest, PROJECT_ENV_KEY_PATTERN, [key]) ||
      !apply(regexpTest, PROJECT_ENV_VALUE_PATTERN, [value])
    ) {
      throw createRequestBodyReadError("Project environment snapshot contains an invalid entry");
    }

    totalBytes += semanticByteLength(key);
    totalBytes += semanticByteLength(value);
    if (totalBytes > PROJECT_ENV_SNAPSHOT_LIMITS.maxUtf8Bytes) {
      throw createRequestBodyReadError("Project environment snapshot exceeds the worker limit");
    }

    objectDefineProperty(output, key, {
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return objectFreeze(output);
}

function snapshotProjectEnvForWorker(): ProjectEnvSnapshot | undefined {
  return snapshotProjectEnvRecordForWorker(getProjectEnvSnapshot());
}

/** @internal Captured-primordial project env snapshot regression hook. */
export const __snapshotProjectEnvRecordForTests = snapshotProjectEnvRecordForWorker;

function appendSourcePolicyMaterial(
  parts: string[],
  policy: SourceIntegrationPolicyManifest,
): void {
  appendFramed(parts, "policy-v1");
  appendFramed(parts, policy.mode);
  if (policy.mode === "unrestricted") return;

  const integrationKeys = objectKeys(policy.integrations);
  apply(arraySort, integrationKeys, []);
  for (let index = 0; index < integrationKeys.length; index++) {
    const integration = integrationKeys[index]!;
    const restriction = policy.integrations[integration];
    if (!restriction) {
      throw createRequestBodyReadError("Source integration policy is invalid");
    }
    appendFramed(parts, integration);
    if (restriction.allowedToolIds === null) {
      appendFramed(parts, "*");
      continue;
    }
    appendFramed(parts, "list");
    for (let toolIndex = 0; toolIndex < restriction.allowedToolIds.length; toolIndex++) {
      appendFramed(parts, restriction.allowedToolIds[toolIndex]!);
    }
  }
}

async function digestSemanticMaterial(material: string): Promise<string> {
  const bytes = encodeSemanticMaterial(material);
  const digest = await apply(subtleDigest, nativeSubtleCrypto, [
    "SHA-256",
    bytes,
  ]) as ArrayBuffer;
  const digestBytes = new NativeUint8Array(digest);
  const digestByteLength = apply(typedArrayByteLengthGetter, digestBytes, []) as number;
  const hex: string[] = [];
  for (let index = 0; index < digestByteLength; index++) {
    const encoded = apply(numberToString, digestBytes[index]!, [16]) as string;
    appendSemanticPart(hex, apply(stringPadStart, encoded, [2, "0"]) as string);
  }
  return apply(arrayJoin, hex, [""]) as string;
}

interface WorkerSemanticContext {
  readonly projectEnv?: ProjectEnvSnapshot;
  readonly sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  readonly generation: string;
}

async function snapshotWorkerSemanticContext(): Promise<WorkerSemanticContext> {
  const projectEnv = snapshotProjectEnvForWorker();
  const sourceIntegrationPolicy = requireActiveSourceIntegrationPolicy();
  const parts: string[] = [];
  appendFramed(parts, "env");
  if (projectEnv) {
    const envKeys = objectKeys(projectEnv);
    for (let index = 0; index < envKeys.length; index++) {
      const key = envKeys[index]!;
      appendFramed(parts, key);
      appendFramed(parts, projectEnv[key]!);
    }
  }
  appendSourcePolicyMaterial(parts, sourceIntegrationPolicy);

  return {
    projectEnv,
    sourceIntegrationPolicy,
    generation: await digestSemanticMaterial(apply(arrayJoin, parts, ["|"]) as string),
  };
}

async function resolveApiWorkerId(
  baseScopeId: string,
  generation: string,
): Promise<string> {
  const identity = snapshotWorkerGenerationIdentity(baseScopeId, generation);
  if (!identity) {
    throw new TypeError("API worker generation identity is required");
  }
  return (await resolveWorkerGeneration("api", identity)).workerId;
}

/**
 * Convert an error to RFC 9457 error response with environment-aware filtering.
 * Delegates to the shared errorToRFC9457Response from http-error-boundary.
 */
function handleAPIError(
  error: unknown,
  pathname: string,
  isLocalProject: boolean,
): Response {
  const detached = detachThrowableForBoundary(error);
  logger.error(`API route error in ${pathname}:`, detached);

  const ctx = { isLocalProject } as HandlerContext;
  const req = new NativeRequest(`http://localhost${pathname}`);
  return errorToRFC9457Response(detached, ctx, req);
}

interface ExecuteRouteOptionsSnapshot {
  readonly modulePath?: string;
  readonly projectDir?: string;
  readonly isLocalProject: boolean;
  readonly allowHostProjectCodeExecution: boolean;
  readonly applicationIdentity: ApplicationIdentity | null;
  readonly preparedModule?: PreparedWorkerModule;
  readonly executionScopeId?: string;
}

function defineExecuteRouteOption(
  snapshot: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  apply(objectDefineProperty, undefined, [
    snapshot,
    key,
    {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    },
  ]);
}

function snapshotExecuteRouteOptions(
  options?: ExecuteRouteOptions,
): ExecuteRouteOptionsSnapshot {
  const rawModulePath = readOwnDataProperty(options, "modulePath");
  const rawProjectDir = readOwnDataProperty(options, "projectDir");
  const rawApplicationIdentity = readOwnDataProperty(options, "applicationIdentity");
  const rawPreparedModule = readOwnDataProperty(options, "preparedModule");
  const rawExecutionScopeId = readOwnDataProperty(options, "executionScopeId");
  const isLocalProject = isExplicitlyLocalProject(options);
  const snapshot = objectCreate(null) as Record<string, unknown>;
  defineExecuteRouteOption(
    snapshot,
    "modulePath",
    typeof rawModulePath === "string" ? rawModulePath : undefined,
  );
  defineExecuteRouteOption(
    snapshot,
    "projectDir",
    typeof rawProjectDir === "string" ? rawProjectDir : undefined,
  );
  defineExecuteRouteOption(
    snapshot,
    "isLocalProject",
    isLocalProject,
  );
  defineExecuteRouteOption(
    snapshot,
    "allowHostProjectCodeExecution",
    isLocalProject || isExplicitHostProjectCodeExecutionAllowed(options),
  );
  defineExecuteRouteOption(
    snapshot,
    "applicationIdentity",
    snapshotExecuteRouteApplicationIdentity(rawApplicationIdentity),
  );
  defineExecuteRouteOption(
    snapshot,
    "preparedModule",
    typeof rawPreparedModule === "object" && rawPreparedModule !== null
      ? rawPreparedModule
      : undefined,
  );
  defineExecuteRouteOption(
    snapshot,
    "executionScopeId",
    typeof rawExecutionScopeId === "string" && rawExecutionScopeId.length > 0
      ? rawExecutionScopeId
      : undefined,
  );

  return apply(objectFreeze, undefined, [snapshot]) as ExecuteRouteOptionsSnapshot;
}

function snapshotExecuteRouteApplicationIdentity(
  value: unknown,
): ApplicationIdentity | null {
  if (value === undefined || value === null) return null;
  return snapshotApplicationIdentity(value);
}

function createProjectScopedFs(fs: FileSystemAdapter, projectDir: string): FileSystemAdapter {
  const resolvePath = (path: string): string => (isAbsolute(path) ? path : join(projectDir, path));

  return {
    readFile: (path: string) => fs.readFile(resolvePath(path)),
    readFileBytes: fs.readFileBytes
      ? (path: string) => fs.readFileBytes!(resolvePath(path))
      : undefined,
    readFileBytesBounded: fs.readFileBytesBounded
      ? (path: string, byteLimit: number) => fs.readFileBytesBounded!(resolvePath(path), byteLimit)
      : undefined,
    writeFile: (path: string, content: string) => fs.writeFile(resolvePath(path), content),
    exists: (path: string) => fs.exists(resolvePath(path)),
    readDir: (path: string) => fs.readDir(resolvePath(path)),
    stat: (path: string) => fs.stat(resolvePath(path)),
    mkdir: (path: string, options?: { recursive?: boolean }) =>
      fs.mkdir(resolvePath(path), options),
    remove: (path: string, options?: { recursive?: boolean }) =>
      fs.remove(resolvePath(path), options),
    makeTempDir: fs.makeTempDir,
    watch: fs.watch,
    resolveFile: fs.resolveFile ? (path: string) => fs.resolveFile!(resolvePath(path)) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Worker Isolation Helpers
// ---------------------------------------------------------------------------

function checkContentLengthLimit(contentLength: string | null): number | null {
  if (contentLength === null) return null;
  if (!apply(regexpTest, CONTENT_LENGTH_PATTERN, [contentLength])) {
    throw toError(
      createError({
        type: "api",
        message: "Invalid Content-Length for isolated execution",
      }),
    );
  }

  let firstDigit = 0;
  while (
    firstDigit < contentLength.length - 1 &&
    apply(stringCharCodeAt, contentLength, [firstDigit]) === 48
  ) {
    firstDigit++;
  }
  const normalized = apply(stringSlice, contentLength, [firstDigit]) as string;
  const limit = MAX_WORKER_BODY_BYTES_DECIMAL;
  const exceedsLimit = normalized.length > limit.length ||
    (normalized.length === limit.length && normalized > limit);
  if (exceedsLimit) throw createRequestBodyTooLargeError();
  return NativeNumber(normalized);
}

function createRequestBodyTooLargeError(bytesRead?: number): Error {
  const actual = bytesRead === undefined
    ? "declared Content-Length exceeds the limit"
    : `${bytesRead} bytes`;
  return toError(
    createError({
      type: "api",
      message:
        `Request body too large for isolated execution (${actual}, limit ${MAX_WORKER_BODY_BYTES} bytes)`,
    }),
  );
}

function createRequestBodyReadError(message: string): Error {
  return toError(createError({ type: "api", message }));
}

function createContentLengthMismatchError(): Error {
  return createRequestBodyReadError(
    "Request body does not match Content-Length for isolated execution",
  );
}

function createRequestBodyAbortError(): Error {
  return createRequestBodyReadError(
    "Request body read aborted for isolated execution",
  );
}

function cancelBodyReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): void {
  void (async () => {
    try {
      await apply(readerCancel, reader, [reason]);
    } catch {
      // Cancellation is best effort after the primary body error is known.
    }
  })();
}

function cancelBodyStream(
  stream: ReadableStream<Uint8Array>,
  reason: unknown,
): void {
  void (async () => {
    try {
      await apply(streamCancel, stream, [reason]);
    } catch {
      // A locked or failed stream cannot be cancelled from this boundary.
    }
  })();
}

function isAbortSignalAborted(signal: AbortSignal): boolean {
  return apply(abortSignalAbortedGetter, signal, []) as boolean;
}

function createUint8ArrayView(
  source: Uint8Array,
  relativeOffset: number,
  length: number,
): Uint8Array {
  const buffer = apply(typedArrayBufferGetter, source, []) as ArrayBufferLike;
  const byteOffset = apply(typedArrayByteOffsetGetter, source, []) as number;
  return new NativeUint8Array(buffer, byteOffset + relativeOffset, length);
}

function yieldBodyReadTask(): Promise<void> {
  return new NativePromise((resolve) => {
    apply(nativeSetTimeout, globalThis, [resolve, 0]);
  });
}

interface BodyReadAbortGate {
  failure: Error | undefined;
  rejectPending: ((reason: unknown) => void) | undefined;
}

function waitForBodyRead<T>(
  pending: Promise<T>,
  gate: BodyReadAbortGate,
): Promise<T> {
  if (gate.failure) {
    return apply(promiseReject, NativePromise, [gate.failure]) as Promise<T>;
  }

  return new NativePromise<T>((resolve, reject) => {
    if (gate.failure) {
      reject(gate.failure);
      return;
    }
    gate.rejectPending = reject;
    apply(promiseThen, pending, [
      (value: T) => {
        if (gate.rejectPending === reject) gate.rejectPending = undefined;
        if (gate.failure) reject(gate.failure);
        else resolve(value);
      },
      (error: unknown) => {
        if (gate.rejectPending === reject) gate.rejectPending = undefined;
        reject(gate.failure ?? error);
      },
    ]);
  });
}

async function readBodyWithSizeGuard(
  bodyStream: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  let declaredLength: number | null;
  try {
    declaredLength = checkContentLengthLimit(contentLength);
  } catch (error) {
    if (bodyStream) cancelBodyStream(bodyStream, error);
    throw error;
  }
  if (!bodyStream) {
    if (declaredLength !== null && declaredLength !== 0) {
      throw createContentLengthMismatchError();
    }
    return null;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = apply(streamGetReader, bodyStream, []) as ReadableStreamDefaultReader<Uint8Array>;
  } catch {
    throw createRequestBodyReadError(
      "Request body is unavailable for isolated execution",
    );
  }

  const blocks: Uint8Array[] = [];
  let currentBlock: Uint8Array | null = null;
  let currentBlockLength = 0;
  let totalBytes = 0;
  let sourceChunks = 0;
  let consecutiveEmptyChunks = 0;
  let chunksSinceYield = 0;
  const abortGate: BodyReadAbortGate = {
    failure: undefined,
    rejectPending: undefined,
  };
  const abortBodyRead = (): void => {
    if (abortGate.failure) return;
    const failure = createRequestBodyAbortError();
    abortGate.failure = failure;
    const rejectPending = abortGate.rejectPending;
    abortGate.rejectPending = undefined;
    cancelBodyReader(reader, failure);
    if (rejectPending) rejectPending(failure);
  };

  if (isAbortSignalAborted(signal)) {
    abortBodyRead();
  } else {
    apply(eventTargetAddEventListener, signal, ["abort", abortBodyRead]);
    if (isAbortSignalAborted(signal)) abortBodyRead();
  }

  try {
    while (true) {
      if (abortGate.failure) throw abortGate.failure;
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        const pendingRead = apply(readerRead, reader, []) as Promise<
          ReadableStreamReadResult<Uint8Array>
        >;
        result = await waitForBodyRead(pendingRead, abortGate);
      } catch (error) {
        if (abortGate.failure) throw abortGate.failure;
        cancelBodyReader(reader);
        throw createRequestBodyReadError(
          `Failed to read request body for isolated execution: ${
            snapshotThrowableDiagnostic(error)
          }`,
        );
      }

      if (
        typeof result !== "object" ||
        result === null ||
        isNativeProxy(result)
      ) {
        cancelBodyReader(reader);
        throw createRequestBodyReadError(
          "Request body stream returned an invalid read result",
        );
      }
      const doneDescriptor = getOwnPropertyDescriptor(result, "done");
      const valueDescriptor = getOwnPropertyDescriptor(result, "value");
      if (
        !doneDescriptor ||
        !("value" in doneDescriptor) ||
        typeof doneDescriptor.value !== "boolean"
      ) {
        cancelBodyReader(reader);
        throw createRequestBodyReadError(
          "Request body stream returned an invalid read result",
        );
      }
      if (doneDescriptor.value) break;

      sourceChunks++;
      if (sourceChunks > MAX_WORKER_BODY_SOURCE_CHUNKS) {
        const failure = createRequestBodyReadError(
          "Request body stream exceeded the chunk limit for isolated execution",
        );
        cancelBodyReader(reader, failure);
        throw failure;
      }

      const chunk = valueDescriptor && "value" in valueDescriptor
        ? valueDescriptor.value
        : undefined;
      if (!isNativeUint8Array(chunk)) {
        cancelBodyReader(reader);
        throw createRequestBodyReadError(
          "Request body stream returned a non-byte chunk",
        );
      }

      const chunkByteLength = apply(typedArrayByteLengthGetter, chunk, []) as number;
      if (chunkByteLength > MAX_WORKER_BODY_BYTES - totalBytes) {
        const bytesRead = totalBytes + chunkByteLength;
        const failure = createRequestBodyTooLargeError(bytesRead);
        cancelBodyReader(reader, failure);
        throw failure;
      }
      if (declaredLength !== null && chunkByteLength > declaredLength - totalBytes) {
        const failure = createContentLengthMismatchError();
        cancelBodyReader(reader, failure);
        throw failure;
      }

      chunksSinceYield++;
      if (chunkByteLength === 0) {
        consecutiveEmptyChunks++;
        if (consecutiveEmptyChunks > MAX_CONSECUTIVE_EMPTY_BODY_CHUNKS) {
          const failure = createRequestBodyReadError(
            "Request body stream made no progress during isolated execution",
          );
          cancelBodyReader(reader, failure);
          throw failure;
        }
      } else {
        consecutiveEmptyChunks = 0;
      }

      if (chunksSinceYield >= BODY_READ_YIELD_CHUNKS) {
        chunksSinceYield = 0;
        await yieldBodyReadTask();
        if (abortGate.failure) throw abortGate.failure;
      }

      if (chunkByteLength === 0) continue;

      totalBytes += chunkByteLength;
      let chunkOffset = 0;
      while (chunkOffset < chunkByteLength) {
        if (currentBlock === null) {
          currentBlock = new NativeUint8Array(BODY_COALESCE_BLOCK_BYTES);
          currentBlockLength = 0;
        }
        const blockRemaining = BODY_COALESCE_BLOCK_BYTES - currentBlockLength;
        const chunkRemaining = chunkByteLength - chunkOffset;
        const copyLength = blockRemaining < chunkRemaining ? blockRemaining : chunkRemaining;
        const sourceSlice = createUint8ArrayView(chunk, chunkOffset, copyLength);
        apply(typedArraySet, currentBlock, [sourceSlice, currentBlockLength]);
        currentBlockLength += copyLength;
        chunkOffset += copyLength;

        if (currentBlockLength === BODY_COALESCE_BLOCK_BYTES) {
          apply(arrayPush, blocks, [currentBlock]);
          currentBlock = null;
          currentBlockLength = 0;
        }
      }
    }

    if (declaredLength !== null && totalBytes !== declaredLength) {
      throw createContentLengthMismatchError();
    }
  } finally {
    apply(eventTargetRemoveEventListener, signal, ["abort", abortBodyRead]);
    abortGate.rejectPending = undefined;
    try {
      apply(readerReleaseLock, reader, []);
    } catch {
      // The body result is already determined; lock release is best effort.
    }
  }

  const body = new NativeUint8Array(totalBytes);
  let offset = 0;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    apply(typedArraySet, body, [block, offset]);
    offset += BODY_COALESCE_BLOCK_BYTES;
  }
  if (currentBlock !== null && currentBlockLength > 0) {
    const finalBlock = createUint8ArrayView(currentBlock, 0, currentBlockLength);
    apply(typedArraySet, body, [finalBlock, offset]);
  }
  return body;
}

async function serializeRequest(
  request: Request,
): Promise<SerializedRequest> {
  const headers = getRequestHeaders(request);
  const url = getRequestUrl(request);
  const method = getRequestMethod(request);
  const serializedHeaders = snapshotHeaders(headers);
  const contentLength = getHeader(headers, "content-length");
  const bodyStream = getRequestBody(request);
  const signal = getRequestSignal(request);

  return {
    url,
    method,
    headers: serializedHeaders,
    body: await readBodyWithSizeGuard(bodyStream, contentLength, signal),
  };
}

/** @internal Captured-primordial request serialization regression hook. */
export const __serializeRequestForTests = serializeRequest;

function deserializeResponse(s: SerializedResponse): Response {
  return deserializeRouteResponse(s);
}

function workerResponseToResponse(
  workerResponse: WorkerResponse,
  pathname: string,
  isLocalProject: boolean,
): Response {
  if (workerResponse.type === "error") {
    const error = deserializeWorkerError(workerResponse.error);
    logger.error(`API route error in ${pathname} (worker):`, error.message);
    return handleAPIError(error, pathname, isLocalProject);
  }

  if (workerResponse.type === "result") {
    return deserializeResponse(workerResponse.response);
  }

  // data-result type is not expected in API route execution
  throw NOT_SUPPORTED.create({ detail: `Unexpected worker response type: ${workerResponse.type}` });
}

const INVALID_WORKER_FIELD = Symbol("invalid-worker-field");
type InvalidWorkerField = typeof INVALID_WORKER_FIELD;

function getDataDescriptors(value: unknown): PropertyDescriptorMap | null {
  if (
    typeof value !== "object" ||
    value === null ||
    apply(arrayIsArray, Array, [value]) ||
    isNativeProxy(value)
  ) {
    return null;
  }

  try {
    const prototype = getPrototypeOf(value);
    if (prototype !== objectPrototype && prototype !== null) return null;
    return getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
}

const MAX_WORKER_ROUTE_METHODS = 128;

function snapshotWorkerRouteMethods(
  response: WorkerRouteMethodsResponse,
): string[] | null {
  const responseDescriptors = getDataDescriptors(response);
  if (!responseDescriptors) return null;
  const rawType = dataField(responseDescriptors, "type");
  const rawMethods = dataField(responseDescriptors, "methods");
  if (
    rawType !== "api-route-methods" ||
    !apply(arrayIsArray, Array, [rawMethods]) ||
    isNativeProxy(rawMethods)
  ) {
    return null;
  }

  const methodsArray = rawMethods as unknown[];
  const lengthDescriptor = getOwnPropertyDescriptor(methodsArray, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof length !== "number" ||
    !numberIsSafeInteger(length) ||
    length < 1 ||
    length > MAX_WORKER_ROUTE_METHODS
  ) {
    return null;
  }

  const methods: string[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = getOwnPropertyDescriptor(methodsArray, `${index}`);
    if (!descriptor || !("value" in descriptor)) return null;
    const method = descriptor.value;
    if (
      typeof method !== "string" ||
      normalizeRouteMethod(method) !== method ||
      apply(arrayIncludes, methods, [method])
    ) {
      return null;
    }
    apply(arrayPush, methods, [method]);
  }

  const canonical: string[] = [];
  const custom: string[] = [];
  for (let index = 0; index < STANDARD_ROUTE_METHODS.length; index++) {
    const method = STANDARD_ROUTE_METHODS[index]!;
    if (apply(arrayIncludes, methods, [method])) {
      apply(arrayPush, canonical, [method]);
    }
  }
  for (let index = 0; index < methods.length; index++) {
    const method = methods[index]!;
    if (!apply(arrayIncludes, STANDARD_ROUTE_METHODS, [method])) {
      apply(arrayPush, custom, [method]);
    }
  }
  apply(arraySort, custom, []);
  for (let index = 0; index < custom.length; index++) {
    apply(arrayPush, canonical, [custom[index]!]);
  }
  if (canonical.length !== methods.length) return null;
  for (let index = 0; index < methods.length; index++) {
    if (methods[index] !== canonical[index]) return null;
  }
  return methods;
}

function dataField(
  descriptors: PropertyDescriptorMap,
  key: string,
): unknown | InvalidWorkerField {
  const descriptor = descriptors[key];
  if (!descriptor) return undefined;
  return "value" in descriptor ? descriptor.value : INVALID_WORKER_FIELD;
}

// ---------------------------------------------------------------------------
// Isolated Execution (Worker Path)
// ---------------------------------------------------------------------------

function executeAppRouteIsolated(
  executionScopeId: string,
  module: PreparedWorkerModule,
  modulePath: string,
  request: Request,
  match: RouteMatch,
  pathname: string,
  projectDir: string,
  isLocalProject: boolean,
  applicationIdentity: ApplicationIdentity | null,
): Promise<Response> {
  const method = uppercaseMethod(getRequestMethod(request));

  return withSpan(
    "api.executeAppRoute.isolated",
    async () => {
      try {
        const pool = getWorkerPool();
        const serialized = await serializeRequest(request);
        const semanticContext = await snapshotWorkerSemanticContext();
        const workerApplicationIdentity = applicationIdentity === null
          ? null
          : snapshotApplicationIdentity(applicationIdentity);

        const workerResponse = await pool.execute(
          await resolveApiWorkerId(executionScopeId, semanticContext.generation),
          [projectDir],
          {
            type: "execute-app-route",
            id: randomUUID(),
            module,
            modulePath,
            method,
            request: serialized,
            params: normalizeParams(match.params),
            projectDir,
            sourceIntegrationPolicy: semanticContext.sourceIntegrationPolicy,
            projectEnv: semanticContext.projectEnv,
            applicationIdentity: workerApplicationIdentity,
          },
        );

        const response = workerResponseToResponse(
          workerResponse,
          pathname,
          isLocalProject,
        );
        return method === "HEAD" ? normalizeRouteHeadResponse(response) : response;
      } catch (error) {
        return handleAPIError(error, pathname, isLocalProject);
      }
    },
    {
      "http.method": method,
      "http.path": pathname,
      "api.route.pattern": match.route.pattern,
      "api.isolated": true,
    },
  );
}

function executePagesRouteIsolated(
  executionScopeId: string,
  module: PreparedWorkerModule,
  modulePath: string,
  request: Request,
  match: RouteMatch,
  pathname: string,
  projectDir: string,
  isLocalProject: boolean,
  applicationIdentity: ApplicationIdentity | null,
): Promise<Response> {
  const method = uppercaseMethod(getRequestMethod(request));

  return withSpan(
    "api.executePagesRoute.isolated",
    async () => {
      try {
        const pool = getWorkerPool();
        const serialized = await serializeRequest(request);
        const semanticContext = await snapshotWorkerSemanticContext();
        const workerApplicationIdentity = applicationIdentity === null
          ? null
          : snapshotApplicationIdentity(applicationIdentity);

        const workerResponse = await pool.execute(
          await resolveApiWorkerId(executionScopeId, semanticContext.generation),
          [projectDir],
          {
            type: "execute-pages-route",
            id: randomUUID(),
            module,
            modulePath,
            method,
            context: {
              url: serialized.url,
              method: serialized.method,
              headers: serialized.headers,
              body: serialized.body,
              params: match.params,
              cookies: parseCookies(
                findSerializedHeader(serialized.headers, "cookie") ?? "",
              ),
            },
            projectDir,
            sourceIntegrationPolicy: semanticContext.sourceIntegrationPolicy,
            projectEnv: semanticContext.projectEnv,
            applicationIdentity: workerApplicationIdentity,
          },
        );

        const response = workerResponseToResponse(
          workerResponse,
          pathname,
          isLocalProject,
        );
        return method === "HEAD" ? normalizeRouteHeadResponse(response) : response;
      } catch (error) {
        return handleAPIError(error, pathname, isLocalProject);
      }
    },
    {
      "http.method": method,
      "http.path": pathname,
      "api.route.pattern": match.route.pattern,
      "api.isolated": true,
    },
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExecuteRouteOptions {
  /** Absolute path to the handler module on disk (for isolated execution) */
  modulePath?: string;
  /** Project directory (for isolated execution scope) */
  projectDir?: string;
  /** Whether the handler module belongs to a trusted local development project. */
  isLocalProject?: boolean;
  /**
   * Whether runtime trust resolution permits this project module to execute in
   * the server process. Local development projects retain this capability
   * through `isLocalProject`.
   */
  allowHostProjectCodeExecution?: boolean;
  /** Non-evaluated, policy-checked route source for worker execution. */
  preparedModule?: PreparedWorkerModule;
  /** Opaque tenant/version/handler-lifetime worker isolation key. */
  executionScopeId?: string;
  /** Verified application identity admitted by the host-owned auth boundary. */
  applicationIdentity?: ApplicationIdentity | null;
}

export interface PreparedRouteExecutionOptions {
  readonly executionScopeId: string;
  readonly module: PreparedWorkerModule;
  readonly modulePath: string;
  readonly projectDir: string;
  readonly isLocalProject: boolean;
  readonly applicationIdentity?: ApplicationIdentity | null;
}

export function executePreparedAppRoute(
  request: Request,
  match: RouteMatch,
  pathname: string,
  options: PreparedRouteExecutionOptions,
): Promise<Response> {
  return executeAppRouteIsolated(
    options.executionScopeId,
    options.module,
    options.modulePath,
    request,
    match,
    pathname,
    options.projectDir,
    options.isLocalProject,
    options.applicationIdentity ?? null,
  );
}

export function executePreparedPagesRoute(
  request: Request,
  match: RouteMatch,
  pathname: string,
  options: PreparedRouteExecutionOptions,
): Promise<Response> {
  return executePagesRouteIsolated(
    options.executionScopeId,
    options.module,
    options.modulePath,
    request,
    match,
    pathname,
    options.projectDir,
    options.isLocalProject,
    options.applicationIdentity ?? null,
  );
}

export async function resolvePreparedRouteMethods(
  requestedMethod: string | undefined,
  options: Omit<PreparedRouteExecutionOptions, "isLocalProject">,
  methodOptions: { includeFrameworkOptions?: boolean } = {},
): Promise<string[]> {
  const semanticContext = await snapshotWorkerSemanticContext();
  const workerResponse = await getWorkerPool().execute(
    await resolveApiWorkerId(options.executionScopeId, semanticContext.generation),
    [options.projectDir],
    {
      type: "inspect-api-route-methods",
      id: randomUUID(),
      module: options.module,
      modulePath: options.modulePath,
      requestedMethod,
      ...(methodOptions.includeFrameworkOptions === undefined
        ? {}
        : { includeFrameworkOptions: methodOptions.includeFrameworkOptions }),
      projectDir: options.projectDir,
      sourceIntegrationPolicy: semanticContext.sourceIntegrationPolicy,
      projectEnv: semanticContext.projectEnv,
    },
  );

  if (workerResponse.type === "error") {
    throw deserializeWorkerError(workerResponse.error);
  }
  if (workerResponse.type !== "api-route-methods") {
    throw createRequestBodyReadError(
      "Worker returned an unexpected API route capability response",
    );
  }

  const methods = snapshotWorkerRouteMethods(workerResponse);
  if (!methods) {
    throw createRequestBodyReadError(
      "Worker returned an invalid API route capability response",
    );
  }
  return methods;
}

export function executeAppRoute(
  handler: APIRoute,
  request: Request,
  match: RouteMatch,
  pathname: string,
  _adapter: RuntimeAdapter,
  options?: ExecuteRouteOptions,
): Promise<Response> {
  const routeOptions = snapshotExecuteRouteOptions(options);
  const isLocalProject = routeOptions.isLocalProject === true;
  const isolationRequired = !isHostRealmApiExecution(routeOptions.allowHostProjectCodeExecution);

  // Routes without an explicit host-execution capability require prepared
  // worker execution. Local development projects retain the legacy capability.
  if (isolationRequired) {
    if (
      routeOptions.modulePath &&
      routeOptions.projectDir &&
      routeOptions.preparedModule &&
      routeOptions.executionScopeId
    ) {
      return executeAppRouteIsolated(
        routeOptions.executionScopeId,
        routeOptions.preparedModule,
        routeOptions.modulePath,
        request,
        match,
        pathname,
        routeOptions.projectDir,
        isLocalProject,
        routeOptions.applicationIdentity,
      );
    }
    return resolvePromise(
      handleAPIError(
        createRequestBodyReadError(
          "Isolated API execution requires prepared route source and an execution scope",
        ),
        pathname,
        isLocalProject,
      ),
    );
  }

  // Trusted local-development compatibility path.
  const method = uppercaseMethod(getRequestMethod(request));

  return withSpan(
    "api.executeAppRoute",
    async () => {
      try {
        const handlerModule = handler as Record<string, unknown>;
        const resolvedFn = resolveRouteHandlerExport(handlerModule, method) as
          | AppRouteHandler
          | undefined;

        if (!resolvedFn) return createAppRouteMethodNotAllowed(handlerModule);

        const appContext: AppRouteContext = {
          params: normalizeParams(match.params),
          identity: routeOptions.applicationIdentity,
          env: snapshotProjectEnvForWorker() ?? EMPTY_PROJECT_ENV,
        };
        const pendingResult = resolvedFn(request, appContext);
        const result = isTrustedRouteResponsePromise(pendingResult)
          ? await pendingResult
          : pendingResult;
        return method === "HEAD"
          ? normalizeRouteHeadResponse(result)
          : normalizeRouteResponse(result);
      } catch (error) {
        return handleAPIError(error, pathname, isLocalProject);
      }
    },
    { "http.method": method, "http.path": pathname, "api.route.pattern": match.route.pattern },
  );
}

export function executePagesRoute(
  handler: APIRoute,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
  projectDir?: string,
  options?: ExecuteRouteOptions,
): Promise<Response> {
  const routeOptions = snapshotExecuteRouteOptions(options);
  const isLocalProject = routeOptions.isLocalProject === true;
  const isolationRequired = !isHostRealmApiExecution(routeOptions.allowHostProjectCodeExecution);
  const isolatedProjectDir = routeOptions.projectDir ?? projectDir;

  // Routes without an explicit host-execution capability require prepared
  // worker execution. Local development projects retain the legacy capability.
  if (isolationRequired) {
    if (
      routeOptions.modulePath &&
      isolatedProjectDir &&
      routeOptions.preparedModule &&
      routeOptions.executionScopeId
    ) {
      return executePagesRouteIsolated(
        routeOptions.executionScopeId,
        routeOptions.preparedModule,
        routeOptions.modulePath,
        request,
        match,
        pathname,
        isolatedProjectDir,
        isLocalProject,
        routeOptions.applicationIdentity,
      );
    }
    return resolvePromise(
      handleAPIError(
        createRequestBodyReadError(
          "Isolated API execution requires prepared route source and an execution scope",
        ),
        pathname,
        isLocalProject,
      ),
    );
  }

  // Trusted local-development compatibility path.
  const method = uppercaseMethod(getRequestMethod(request));

  return withSpan(
    "api.executePagesRoute",
    async () => {
      try {
        const methodHandler = resolveRouteHandlerExport(
          handler as Record<string, unknown>,
          method,
        );

        if (!methodHandler) {
          return createPagesRouteMethodNotAllowed(handler as Record<string, unknown>);
        }

        const fs = projectDir ? createProjectScopedFs(adapter.fs, projectDir) : adapter.fs;
        const ctx = createContext(
          request,
          match,
          fs,
          snapshotProjectEnvForWorker() ?? EMPTY_PROJECT_ENV,
          routeOptions.applicationIdentity,
        );
        const pendingResult = (methodHandler as PagesRouteHandler)(ctx);
        const result = isTrustedRouteResponsePromise(pendingResult)
          ? await pendingResult
          : pendingResult;
        return method === "HEAD"
          ? normalizeRouteHeadResponse(result)
          : normalizeRouteResponse(result);
      } catch (error) {
        return handleAPIError(error, pathname, isLocalProject);
      }
    },
    { "http.method": method, "http.path": pathname, "api.route.pattern": match.route.pattern },
  );
}
