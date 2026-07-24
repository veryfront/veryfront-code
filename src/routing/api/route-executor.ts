import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createContext, normalizeParams, parseCookies } from "./context-builder.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import {
  createError,
  ERROR_REGISTRY,
  errorToRFC9457Response,
  NOT_SUPPORTED,
  type RegisteredError,
  toError,
} from "#veryfront/errors";
import {
  detachThrowableForBoundary,
  sanitizeDiagnosticText,
  sanitizeStackDiagnosticText,
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
import {
  getWorkerPool,
  isWorkerIsolationEnabled,
} from "#veryfront/security/sandbox/worker-pool.ts";
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

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectKeys = Object.keys;
const ownKeys = Reflect.ownKeys;
const objectPrototype = Object.prototype;
const numberIsSafeInteger = Number.isSafeInteger;
const NativeArray = Array;
const NativeRequest = Request;
const NativeUint8Array = Uint8Array;
const NativeTextEncoder = TextEncoder;
const semanticTextEncoder = new NativeTextEncoder();
const textEncoderEncode = NativeTextEncoder.prototype.encode;
const nativeSubtleCrypto = crypto.subtle;
const subtleDigest = SubtleCrypto.prototype.digest;
const requestUrlGetter = getOwnPropertyDescriptor(NativeRequest.prototype, "url")!.get!;
const requestMethodGetter = getOwnPropertyDescriptor(NativeRequest.prototype, "method")!.get!;
const requestHeadersGetter = getOwnPropertyDescriptor(NativeRequest.prototype, "headers")!.get!;
const requestBodyGetter = getOwnPropertyDescriptor(NativeRequest.prototype, "body")!.get!;
const headersGet = Headers.prototype.get;
const headersForEach = Headers.prototype.forEach;
const streamGetReader = ReadableStream.prototype.getReader;
const readerRead = ReadableStreamDefaultReader.prototype.read;
const readerCancel = ReadableStreamDefaultReader.prototype.cancel;
const readerReleaseLock = ReadableStreamDefaultReader.prototype.releaseLock;
const typedArrayPrototype = Object.getPrototypeOf(NativeUint8Array.prototype);
const typedArrayByteLengthGetter = getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
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
const cryptoRandomUUID = Crypto.prototype.randomUUID;
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
const MAX_WORKER_PROJECT_ENV_ENTRIES = 4_096;
const MAX_WORKER_PROJECT_ENV_KEY_CHARS = 1_024;
const MAX_WORKER_PROJECT_ENV_VALUE_CHARS = 1024 * 1024;
const MAX_WORKER_PROJECT_ENV_UTF8_BYTES = 1024 * 1024;

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

function getHeader(headers: Headers, name: string): string | null {
  return apply(headersGet, headers, [name]) as string | null;
}

function snapshotHeaders(headers: Headers): [string, string][] {
  const result: [string, string][] = [];
  apply(headersForEach, headers, [
    (value: string, name: string) => {
      apply(arrayPush, result, [[name, value]]);
    },
  ]);
  return result;
}

function uppercaseMethod(method: string): string {
  return apply(stringToUpperCase, method, []) as string;
}

function randomUUID(): string {
  return apply(cryptoRandomUUID, crypto, []) as string;
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
 * Read the current project env snapshot via the globalThis bridge registered by
 * server/project-env/storage.ts.  This avoids a direct import from the server/
 * layer (which would violate the layer architecture).
 */
function getProjectEnvSnapshot(): Record<string, string> | undefined {
  return getTrustedProjectEnvSnapshot();
}

function encodeSemanticMaterial(value: string): Uint8Array {
  return apply(textEncoderEncode, semanticTextEncoder, [value]) as Uint8Array;
}

function appendFramed(parts: string[], value: string): void {
  const length = apply(numberToString, value.length, [10]) as string;
  apply(arrayPush, parts, [`${length}:${value}`]);
}

function snapshotProjectEnvForWorker(): Record<string, string> | undefined {
  const raw = getProjectEnvSnapshot();
  if (raw === undefined) return undefined;

  const descriptors = getDataDescriptors(raw);
  if (!descriptors) {
    throw createRequestBodyReadError("Project environment snapshot must be a plain data record");
  }

  const reflectedKeys = ownKeys(raw);
  const keys = objectKeys(descriptors);
  if (
    reflectedKeys.length !== keys.length ||
    keys.length > MAX_WORKER_PROJECT_ENV_ENTRIES
  ) {
    throw createRequestBodyReadError("Project environment snapshot is invalid or too large");
  }
  apply(arraySort, keys, []);

  const output = objectCreate(null) as Record<string, string>;
  let totalBytes = 0;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = descriptors[key];
    const value = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (
      !descriptor?.enumerable ||
      typeof value !== "string" ||
      key.length > MAX_WORKER_PROJECT_ENV_KEY_CHARS ||
      value.length > MAX_WORKER_PROJECT_ENV_VALUE_CHARS ||
      !apply(regexpTest, PROJECT_ENV_KEY_PATTERN, [key]) ||
      !apply(regexpTest, PROJECT_ENV_VALUE_PATTERN, [value])
    ) {
      throw createRequestBodyReadError("Project environment snapshot contains an invalid entry");
    }

    totalBytes += encodeSemanticMaterial(key).byteLength;
    totalBytes += encodeSemanticMaterial(value).byteLength;
    if (totalBytes > MAX_WORKER_PROJECT_ENV_UTF8_BYTES) {
      throw createRequestBodyReadError("Project environment snapshot exceeds the worker limit");
    }

    objectDefineProperty(output, key, {
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return output;
}

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
  const hex = new NativeArray<string>(digestBytes.byteLength);
  for (let index = 0; index < digestBytes.byteLength; index++) {
    const encoded = apply(numberToString, digestBytes[index]!, [16]) as string;
    hex[index] = apply(stringPadStart, encoded, [2, "0"]) as string;
  }
  return apply(arrayJoin, hex, [""]) as string;
}

interface WorkerSemanticContext {
  readonly projectEnv?: Record<string, string>;
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

function generatedExecutionScopeId(baseScopeId: string, generation: string): string {
  return `${baseScopeId}:generation:${generation}`;
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
  readonly isLocalProject?: boolean;
  readonly preparedModule?: PreparedWorkerModule;
  readonly executionScopeId?: string;
}

function snapshotExecuteRouteOptions(
  options?: ExecuteRouteOptions,
): ExecuteRouteOptionsSnapshot {
  if (!options) return {};

  let modulePath: string | undefined;
  let projectDir: string | undefined;
  let isLocalProject: boolean | undefined;
  let preparedModule: PreparedWorkerModule | undefined;
  let executionScopeId: string | undefined;

  try {
    const value = options.isLocalProject;
    if (value === true || value === false) isLocalProject = value;
  } catch {
    // Local diagnostics are privileged. Unreadable ownership fails closed.
    isLocalProject = false;
  }
  try {
    if (typeof options.modulePath === "string") modulePath = options.modulePath;
  } catch {
    // An unreadable optional isolation path disables the isolated path.
  }
  try {
    if (typeof options.projectDir === "string") projectDir = options.projectDir;
  } catch {
    // An unreadable optional project path disables the isolated path.
  }
  try {
    const value = options.preparedModule;
    if (typeof value === "object" && value !== null) preparedModule = value;
  } catch {
    // Unreadable prepared source fails the isolation admission check.
  }
  try {
    const value = options.executionScopeId;
    if (typeof value === "string" && value.length > 0) executionScopeId = value;
  } catch {
    // Unreadable execution identity fails the isolation admission check.
  }

  return Object.freeze({
    modulePath,
    projectDir,
    isLocalProject,
    preparedModule,
    executionScopeId,
  });
}

function createProjectScopedFs(fs: FileSystemAdapter, projectDir: string): FileSystemAdapter {
  const resolvePath = (path: string): string => (isAbsolute(path) ? path : join(projectDir, path));

  return {
    readFile: (path: string) => fs.readFile(resolvePath(path)),
    readFileBytes: fs.readFileBytes
      ? (path: string) => fs.readFileBytes!(resolvePath(path))
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

function checkContentLengthLimit(contentLength: string | null): void {
  if (contentLength === null) return;
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
}

let warnedUntrustedInProcessExecution = false;

export function __resetInProcessIsolationWarningForTests(): void {
  warnedUntrustedInProcessExecution = false;
}

function warnIfUntrustedInProcessExecution(
  routeKind: "app" | "pages",
  pathname: string,
  options: ExecuteRouteOptionsSnapshot,
): void {
  if (options.isLocalProject !== false) return;
  if (isWorkerIsolationEnabled()) return;
  if (warnedUntrustedInProcessExecution) return;

  warnedUntrustedInProcessExecution = true;
  try {
    logger.warn(
      "Untrusted project code is executing in-process with worker isolation disabled. Enable WORKER_ISOLATION_ENABLED=1 and WORKER_ISOLATION_API=1 to run project routes in a permission-restricted worker.",
      {
        modulePath: options.modulePath,
        pathname,
        projectDir: options.projectDir,
        requiredEnv: ["WORKER_ISOLATION_ENABLED", "WORKER_ISOLATION_API"],
        routeKind,
        workerIsolationEnabled: false,
      },
    );
  } catch {
    // A diagnostic warning must not prevent the API route from running.
  }
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

function cancelBodyReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void (async () => {
    try {
      await apply(readerCancel, reader, []);
    } catch {
      // Cancellation is best effort after the primary body error is known.
    }
  })();
}

async function readBodyWithSizeGuard(
  bodyStream: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
): Promise<Uint8Array | null> {
  checkContentLengthLimit(contentLength);
  if (!bodyStream) return null;

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = apply(streamGetReader, bodyStream, []) as ReadableStreamDefaultReader<Uint8Array>;
  } catch {
    throw createRequestBodyReadError(
      "Request body is unavailable for isolated execution",
    );
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await apply(readerRead, reader, []) as ReadableStreamReadResult<Uint8Array>;
      } catch (error) {
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
        cancelBodyReader(reader);
        throw createRequestBodyTooLargeError(bytesRead);
      }

      apply(arrayPush, chunks, [chunk]);
      totalBytes += chunkByteLength;
    }
  } finally {
    try {
      apply(readerReleaseLock, reader, []);
    } catch {
      // The body result is already determined; lock release is best effort.
    }
  }

  const body = new NativeUint8Array(totalBytes);
  let offset = 0;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!;
    apply(typedArraySet, body, [chunk, offset]);
    offset += apply(typedArrayByteLengthGetter, chunk, []) as number;
  }
  return body;
}

async function serializeRequest(request: Request): Promise<SerializedRequest> {
  const headers = getRequestHeaders(request);
  const url = getRequestUrl(request);
  const method = getRequestMethod(request);
  const serializedHeaders = snapshotHeaders(headers);
  const contentLength = getHeader(headers, "content-length");
  const bodyStream = getRequestBody(request);

  return {
    url,
    method,
    headers: serializedHeaders,
    body: await readBodyWithSizeGuard(bodyStream, contentLength),
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

function applySerializedStack(error: Error, stack: unknown): void {
  if (typeof stack !== "string") return;
  try {
    Object.defineProperty(error, "stack", {
      configurable: true,
      value: stack,
      writable: true,
    });
  } catch {
    // The shared boundary still returns a safe response without a stack.
  }
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

function optionalDiagnostic(
  descriptors: PropertyDescriptorMap,
  key: string,
): string | undefined | InvalidWorkerField {
  const value = dataField(descriptors, key);
  if (value === INVALID_WORKER_FIELD) return value;
  if (value === undefined) return undefined;
  return typeof value === "string" ? sanitizeDiagnosticText(value) : INVALID_WORKER_FIELD;
}

interface WorkerErrorSnapshot {
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
  readonly definition?: RegisteredError;
  readonly status?: number;
  readonly detail?: string;
  readonly cause?: string;
  readonly instance?: string;
}

function snapshotSerializedWorkerError(serialized: unknown): WorkerErrorSnapshot {
  const descriptors = getDataDescriptors(serialized);
  if (!descriptors) {
    return { message: "Unknown error", name: "Error" };
  }

  const rawMessage = dataField(descriptors, "message");
  const rawName = dataField(descriptors, "name");
  const rawStack = dataField(descriptors, "stack");
  const message = typeof rawMessage === "string"
    ? sanitizeDiagnosticText(rawMessage)
    : "Unknown error";
  const name = typeof rawName === "string" ? sanitizeDiagnosticText(rawName) : "Error";
  const stack = typeof rawStack === "string" ? sanitizeStackDiagnosticText(rawStack) : undefined;

  const problem = dataField(descriptors, "problem");
  const problemDescriptors = getDataDescriptors(problem);
  if (!problemDescriptors) return { message, name, stack };

  const slug = dataField(problemDescriptors, "slug");
  if (typeof slug !== "string" || !Object.hasOwn(ERROR_REGISTRY, slug)) {
    return { message, name, stack };
  }

  const definition = ERROR_REGISTRY[slug as keyof typeof ERROR_REGISTRY];
  const category = dataField(problemDescriptors, "category");
  const status = dataField(problemDescriptors, "status");
  const title = dataField(problemDescriptors, "title");
  const suggestion = dataField(problemDescriptors, "suggestion");
  if (
    category !== definition.category ||
    title !== definition.title ||
    suggestion !== definition.suggestion ||
    typeof status !== "number" ||
    !Number.isInteger(status) ||
    status < 400 ||
    status >= 600
  ) {
    return { message, name, stack };
  }

  const detail = optionalDiagnostic(problemDescriptors, "detail");
  const cause = optionalDiagnostic(problemDescriptors, "cause");
  const instance = optionalDiagnostic(problemDescriptors, "instance");
  if (
    detail === INVALID_WORKER_FIELD ||
    cause === INVALID_WORKER_FIELD ||
    instance === INVALID_WORKER_FIELD
  ) {
    return { message, name, stack };
  }

  return {
    message,
    name,
    stack,
    definition,
    status,
    detail,
    cause,
    instance,
  };
}

function deserializeWorkerError(
  serialized: unknown,
): Error {
  const snapshot = snapshotSerializedWorkerError(serialized);
  if (snapshot.definition) {
    const error = snapshot.definition.create({
      message: snapshot.message,
      status: snapshot.status,
      detail: snapshot.detail,
      cause: snapshot.cause,
      instance: snapshot.instance,
    });
    applySerializedStack(error, snapshot.stack);
    return error;
  }

  const error = new Error(snapshot.message);
  error.name = snapshot.name;
  applySerializedStack(error, snapshot.stack);
  return error;
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
): Promise<Response> {
  const method = uppercaseMethod(getRequestMethod(request));

  return withSpan(
    "api.executeAppRoute.isolated",
    async () => {
      try {
        const pool = getWorkerPool();
        const serialized = await serializeRequest(request);
        const semanticContext = await snapshotWorkerSemanticContext();

        const workerResponse = await pool.execute(
          generatedExecutionScopeId(executionScopeId, semanticContext.generation),
          [projectDir],
          {
            type: "execute-app-route",
            id: randomUUID(),
            module,
            modulePath,
            method,
            request: serialized,
            params: match.params,
            projectDir,
            sourceIntegrationPolicy: semanticContext.sourceIntegrationPolicy,
            projectEnv: semanticContext.projectEnv,
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
): Promise<Response> {
  const method = uppercaseMethod(getRequestMethod(request));

  return withSpan(
    "api.executePagesRoute.isolated",
    async () => {
      try {
        const pool = getWorkerPool();
        const serialized = await serializeRequest(request);
        const semanticContext = await snapshotWorkerSemanticContext();

        const workerResponse = await pool.execute(
          generatedExecutionScopeId(executionScopeId, semanticContext.generation),
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
  /** Non-evaluated, policy-checked route source for worker execution. */
  preparedModule?: PreparedWorkerModule;
  /** Opaque tenant/version/handler-lifetime worker isolation key. */
  executionScopeId?: string;
}

export interface PreparedRouteExecutionOptions {
  readonly executionScopeId: string;
  readonly module: PreparedWorkerModule;
  readonly modulePath: string;
  readonly projectDir: string;
  readonly isLocalProject: boolean;
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
  );
}

export async function resolvePreparedRouteMethods(
  requestedMethod: string | undefined,
  options: Omit<PreparedRouteExecutionOptions, "isLocalProject">,
): Promise<string[]> {
  const semanticContext = await snapshotWorkerSemanticContext();
  const workerResponse = await getWorkerPool().execute(
    generatedExecutionScopeId(options.executionScopeId, semanticContext.generation),
    [options.projectDir],
    {
      type: "inspect-api-route-methods",
      id: randomUUID(),
      module: options.module,
      modulePath: options.modulePath,
      requestedMethod,
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
  const workerIsolationEnabled = isWorkerIsolationEnabled();

  // Isolated path: execute in a per-project Worker and contain failures there.
  if (workerIsolationEnabled) {
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
      );
    }
    return Promise.resolve(
      handleAPIError(
        createRequestBodyReadError(
          "Worker-isolated API execution requires prepared route source and an execution scope",
        ),
        pathname,
        isLocalProject,
      ),
    );
  }

  // Default path: execute in main process (existing behavior)
  warnIfUntrustedInProcessExecution("app", pathname, routeOptions);
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

        const appContext: AppRouteContext = { params: normalizeParams(match.params) };
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
  const workerIsolationEnabled = isWorkerIsolationEnabled();
  const isolatedProjectDir = routeOptions.projectDir ?? projectDir;

  // Isolated path: execute in a per-project Worker and contain failures there.
  if (workerIsolationEnabled) {
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
      );
    }
    return Promise.resolve(
      handleAPIError(
        createRequestBodyReadError(
          "Worker-isolated API execution requires prepared route source and an execution scope",
        ),
        pathname,
        isLocalProject,
      ),
    );
  }

  // Default path: execute in main process (existing behavior)
  warnIfUntrustedInProcessExecution("pages", pathname, routeOptions);
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
        const ctx = createContext(request, match, fs);
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
