/**
 * Worker Script — Runs inside each per-project Deno Worker
 *
 * Handles messages from the main process, dynamically imports user modules,
 * and executes API route handlers in an isolated context.
 *
 * This file is the Worker entrypoint — it is loaded once when the Worker
 * is created and stays resident for the lifetime of the Worker.
 *
 * @module security/sandbox/worker-script
 */

// Capture host-environment primordials before any project module is imported.
import "#veryfront/platform/compat/process/env.ts";

import type {
  ExecuteAppRouteRequest,
  ExecutePagesRouteRequest,
  FetchDataRequest,
  InspectApiRouteMethodsRequest,
  PreparedWorkerModule,
  RenderSSRRequest,
  SerializedDataContext,
  SerializedDataResult,
  SerializedError,
  SerializedPagesContext,
  SerializedRequest,
  SerializedResponse,
  WorkerDataResultResponse,
  WorkerErrorResponse,
  WorkerPreparedModuleCapacityResponse,
  WorkerRequest,
  WorkerResultResponse,
  WorkerRouteMethodsResponse,
  WorkerSSRExecutionOpen,
  WorkerSSROutputLimit,
  WorkerSSRWireError,
  WorkerSSRWireResult,
  WorkerStreamCredit,
  WorkerStreamEnd,
  WorkerStreamFrame,
} from "./worker-types.ts";
import {
  MAX_WORKER_BODY_BYTES,
  MAX_WORKER_MODULE_SOURCE_BYTES,
  MAX_WORKER_REQUEST_ID_CHARS,
  MAX_WORKER_RETAINED_MODULE_SOURCE_BYTES,
  MAX_WORKER_RETAINED_MODULES,
  MAX_WORKER_SSR_CHUNK_BYTES,
  MAX_WORKER_SSR_OUTPUT_BYTES,
  MAX_WORKER_SSR_OUTPUT_CHUNKS,
} from "./worker-types.ts";
import {
  type InstalledWorkerEgressGuardOptions,
  installWorkerEgressGuard,
  type WorkerEgressHttpBrokerConfig,
  type WorkerEgressSocksProxyConfig,
} from "./worker-egress-guard.ts";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve as resolvePath,
  sep as PATH_SEP,
} from "node:path";
import { types as nodeUtilTypes } from "node:util";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { isDataControlResult, toDataControlResult } from "#veryfront/data/helpers.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import { createBodyReader } from "#veryfront/routing/api/context-builder.ts";
import {
  resolveExecutableRouteMethods,
  resolveRouteHandlerExport,
} from "#veryfront/routing/api/route-methods.ts";
import {
  createAppRouteMethodNotAllowed,
  createPagesRouteMethodNotAllowed,
} from "#veryfront/routing/api/method-validator.ts";
import {
  detachThrowableForBoundary,
  isNativeErrorWithoutHooks,
  sanitizeDiagnosticText,
  snapshotErrorForBoundary,
  snapshotThrowableDiagnostic,
} from "#veryfront/errors/safe-diagnostics.ts";
import { IMPORT_RESOLUTION_ERROR, INITIALIZATION_ERROR } from "#veryfront/errors/index.ts";
import {
  type IsolatedSsrRenderer,
  validateIsolatedSsrRendererModuleUrl,
} from "#veryfront/extensions/rendering/index.ts";
import {
  isTrustedRouteResponsePromise,
  serializeRouteResponse,
} from "#veryfront/routing/api/response-normalization.ts";
import { createWorkerExitControls } from "./worker-exit-controls.ts";
import { encodeSandboxBytesAsBase64, encodeSandboxBytesAsHex } from "./worker-byte-encoding.ts";
import { snapshotApplicationIdentity } from "#veryfront/security/application-auth/identity.ts";
import type { ApplicationIdentity } from "#veryfront/security/application-auth/types.ts";

type InitializeEgressMessage = {
  type: "initialize-egress";
  rendererModuleUrl?: string;
  options: InstalledWorkerEgressGuardOptions;
  controlPort: MessagePort;
};

const apply = Reflect.apply;
const cloneStructuredValue = globalThis.structuredClone.bind(globalThis);
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const eventTargetAddEventListener = EventTarget.prototype.addEventListener;
const eventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;
const eventCurrentTargetGetter = getOwnPropertyDescriptor(Event.prototype, "currentTarget")?.get;
const eventIsTrustedGetter = getOwnPropertyDescriptor(Event.prototype, "isTrusted")?.get;
const eventPreventDefault = Event.prototype.preventDefault;
const messageEventDataGetter = getOwnPropertyDescriptor(MessageEvent.prototype, "data")?.get;
const getPrototypeOf = Object.getPrototypeOf;
const objectEntries = Object.entries;
const objectKeys = Object.keys;
const ownKeys = Reflect.ownKeys;
const isArray = Array.isArray;
const isProxy = nodeUtilTypes.isProxy;
const NativeArray = Array;
const NativeError = Error;
const NativeMap = Map;
const NativeMessagePort = MessagePort;
const NativeNotFound = Deno.errors.NotFound;
const NativePromise = Promise;
const NativeRequest = Request;
const NativeResponse = Response;
const NativeSet = Set;
const NativeString = String;
const NativeTypeError = TypeError;
const NativeUint8Array = Uint8Array;
const NativeURL = URL;
const NativeURLSearchParams = URLSearchParams;
const nativeTypeErrorPrototype = NativeTypeError.prototype;
const nativeErrorStackGetter = getOwnPropertyDescriptor(new NativeError(), "stack")?.get;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const uint8ArrayPrototype = NativeUint8Array.prototype;
const typedArrayPrototype = getPrototypeOf(uint8ArrayPrototype);
const typedArrayBufferGetter = typedArrayPrototype
  ? getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get
  : undefined;
const typedArrayByteLengthGetter = typedArrayPrototype
  ? getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get
  : undefined;
const typedArrayByteOffsetGetter = typedArrayPrototype
  ? getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get
  : undefined;
const arrayBufferPrototype = ArrayBuffer.prototype;
const arrayBufferByteLengthGetter = getOwnPropertyDescriptor(
  arrayBufferPrototype,
  "byteLength",
)?.get;
const arrayBufferResizableGetter = getOwnPropertyDescriptor(
  arrayBufferPrototype,
  "resizable",
)?.get;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const encodeText = TextEncoder.prototype.encode;
const decodeText = TextDecoder.prototype.decode;
const setBytes = NativeUint8Array.prototype.set;
const digestBytes = crypto.subtle.digest.bind(crypto.subtle);
const messagePortPostMessage = MessagePort.prototype.postMessage;
const messagePortStart = MessagePort.prototype.start;
const promiseThen = Promise.prototype.then;
const readableStreamGetReader = ReadableStream.prototype.getReader;
const readableStreamReaderCancel = ReadableStreamDefaultReader.prototype.cancel;
const readableStreamReaderRead = ReadableStreamDefaultReader.prototype.read;
const readableStreamReaderReleaseLock = ReadableStreamDefaultReader.prototype.releaseLock;
const arrayPush = Array.prototype.push;
const mapDelete = Map.prototype.delete;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const setSizeGetter = getOwnPropertyDescriptor(Set.prototype, "size")?.get;
const NULL_BODY_STATUSES = new NativeSet([101, 103, 204, 205, 304]);
const jsonStringify = JSON.stringify;
const functionHasInstance = Function.prototype[Symbol.hasInstance];
const arraySort = Array.prototype.sort;
const stringIndexOf = String.prototype.indexOf;
const stringSlice = String.prototype.slice;
const stringStartsWith = String.prototype.startsWith;
const regexpExec = RegExp.prototype.exec;
const regexpReplace = RegExp.prototype[Symbol.replace];
const regexpTest = RegExp.prototype.test;
const objectCreate = Object.create;
const defineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const denoReadDir = Deno.readDir.bind(Deno);
const denoReadFile = Deno.readFile.bind(Deno);
const denoReadTextFile = Deno.readTextFile.bind(Deno);
const denoRealPath = Deno.realPath.bind(Deno);
const denoStat = Deno.stat.bind(Deno);
const nativeWorkerClose = typeof globalThis.close === "function" ? globalThis.close : undefined;
const WORKER_EXIT_MESSAGE = objectFreeze({ type: "worker-exit" as const });
const LOWERCASE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CANONICAL_POLICY_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const CANONICAL_ROUTE_METHOD_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Z]{1,64}$/;
const CANONICAL_DEPENDENCY_PINNING_CACHE_KEY_PATTERN = /^on:(0|[1-9a-z][0-9a-z]{0,12})$/;
const MAX_DEPENDENCY_PINNING_HASH = "3w5e11264sgsf";
const PROJECT_ENV_KEY_PATTERN = /^[^=\0]+$/;
const PROJECT_ENV_VALUE_PATTERN = /^[^\0]*$/;
const DATA_JAVASCRIPT_URL_PATTERN =
  /data:(?:text|application)\/javascript(?:;[a-zA-Z0-9=+._-]+)*,[^ \t\r\n]*/g;
const DATA_JAVASCRIPT_URL_PRESENCE_PATTERN =
  /data:(?:text|application)\/javascript(?:;[a-zA-Z0-9=+._-]+)*,/;
const STACK_LOCATION_PATTERN = /:([0-9]+):([0-9]+)\)?$/;
const SANITIZED_DATA_MODULE_LABEL_PATTERN = /vf-api:(?:[0-9a-f]{64}|unknown)(?::[0-9]+:[0-9]+)?/;
const MAX_WORKER_PATH_CHARS = 32 * 1024;
const MAX_WORKER_URL_CHARS = 64 * 1024;
const MAX_WORKER_HEADER_COUNT = 1_024;
const MAX_WORKER_HEADER_FIELD_CHARS = 64 * 1024;
const MAX_WORKER_HEADER_UTF8_BYTES = 1024 * 1024;
const MAX_WORKER_RECORD_ENTRIES = 4_096;
const MAX_WORKER_VALUE_CHARS = 1024 * 1024;
const MAX_WORKER_STRING_COLLECTION_VALUES = 16_384;
const MAX_WORKER_STRING_COLLECTION_UTF8_BYTES = 4 * 1024 * 1024;
const MAX_WORKER_PROJECT_ENV_UTF8_BYTES = 1024 * 1024;
const MAX_WORKER_POLICY_SEGMENT_CHARS = 256;
const MAX_WORKER_POLICY_UTF8_BYTES = 1024 * 1024;
const MAX_WORKER_ROUTE_METHOD_COUNT = 128;
const MAX_WORKER_DATA_DEPTH = 64;
const MAX_WORKER_DATA_NODES = 100_000;
const MAX_WORKER_DATA_UTF8_BYTES = 16 * 1024 * 1024;

let egressInitialized = false;
let exitNotifierInstalled = false;
let workerControlPort: MessagePort | null = null;
let postControlPortMessage:
  | ((message: unknown, transfer?: readonly Transferable[]) => void)
  | null = null;
let closeWorkerProcess: (() => void) | null = null;
let workerWireGeneration: string | null = null;
let unhandledWorkerFaultClosed = false;

interface SSRExecutionContext {
  readonly id: string;
  readonly generation: string;
  readonly token: string;
  readonly delivery: "string" | "stream";
  sequence: number;
}

interface StreamCreditWaiter {
  readonly id: string;
  readonly generation: string;
  readonly token: string;
  readonly sequence: number;
  readonly resolve: () => void;
}

let pendingSSRExecutionOpen: SSRExecutionContext | null = null;
const activeSSRExecutions = new NativeMap<string, SSRExecutionContext>();
const streamCreditWaiters = new NativeMap<string, StreamCreditWaiter>();
const MAX_SSR_WIRE_TOKEN_CHARS = 256;

function containUnhandledWorkerFault(event: Event): void {
  apply(eventPreventDefault, event, []);
  if (unhandledWorkerFaultClosed) return;
  unhandledWorkerFaultClosed = true;

  const closeWorker = closeWorkerProcess;
  try {
    if (closeWorker) {
      closeWorker();
    } else if (nativeWorkerClose) {
      apply(nativeWorkerClose, globalThis, []);
    }
  } catch {
    // The protected close wrapper invokes the native close in a finally block.
  }
}

function installUnhandledWorkerFaultBoundary(): void {
  if (!nativeWorkerClose) return;
  apply(eventTargetAddEventListener, self, [
    "error",
    containUnhandledWorkerFault as EventListener,
  ]);
  apply(eventTargetAddEventListener, self, [
    "unhandledrejection",
    containUnhandledWorkerFault as EventListener,
  ]);
}

installUnhandledWorkerFaultBoundary();

function createWorkerResponse(
  body: BodyInit | null | undefined,
  contentType: string,
  init?: ResponseInit,
): Response {
  const status = init?.status;
  const responseBody = status !== undefined &&
      apply(setHas, NULL_BODY_STATUSES, [status])
    ? null
    : body;

  return new NativeResponse(responseBody, {
    ...init,
    headers: {
      "Content-Type": contentType,
      ...init?.headers,
    },
  });
}

function createWorkerJsonResponse(data: unknown, init?: ResponseInit): Response {
  return createWorkerResponse(jsonStringify(data), "application/json", init);
}

function createWorkerTextResponse(data: string, init?: ResponseInit): Response {
  return createWorkerResponse(data, "text/plain", init);
}

function sendControlMessage(
  message: unknown,
  transfer?: readonly Transferable[],
): void {
  const postMessage = postControlPortMessage;
  if (!postMessage) {
    throw new NativeError("Worker control channel is not initialized");
  }
  postMessage(message, transfer);
}

function isTrustedMessageEventFrom(
  event: MessageEvent,
  target: EventTarget,
): boolean {
  if (!eventCurrentTargetGetter || !eventIsTrustedGetter) return false;
  return apply(eventIsTrustedGetter, event, []) === true &&
    apply(eventCurrentTargetGetter, event, []) === target;
}

function readMessageEventData(event: MessageEvent): unknown {
  const ownData = getOwnPropertyDescriptor(event, "data");
  if (ownData) {
    if ("value" in ownData) return ownData.value;
    throw new NativeError("MessageEvent data is not a native data field");
  }
  if (!messageEventDataGetter) {
    throw new NativeError("MessageEvent data getter is unavailable");
  }
  return apply(messageEventDataGetter, event, []);
}

function installWorkerExitNotifier(): void {
  if (exitNotifierInstalled || !nativeWorkerClose) return;

  const notifyExit = () => sendControlMessage(WORKER_EXIT_MESSAGE);
  const closeWorker = () => apply(nativeWorkerClose, globalThis, []);
  const exitWorker = typeof Deno.exit === "function" ? Deno.exit.bind(Deno) : undefined;
  const controls = createWorkerExitControls({ notifyExit, closeWorker, exitWorker });
  const workerPostMessage = self.postMessage.bind(self);
  closeWorkerProcess = controls.close;
  Object.defineProperty(self, "postMessage", {
    configurable: false,
    get: () => workerPostMessage,
    set: () => {
      // Project code must not be able to silence worker lifecycle messages.
    },
  });
  Object.defineProperty(globalThis, "close", {
    configurable: false,
    writable: false,
    value: controls.close,
  });
  if (self !== globalThis) {
    Object.defineProperty(self, "close", {
      configurable: false,
      writable: false,
      value: controls.close,
    });
  }
  if (controls.exit !== undefined) {
    Object.defineProperty(Deno, "exit", {
      configurable: false,
      writable: false,
      value: controls.exit,
    });
  }
  exitNotifierInstalled = true;
}

/** True when `child` is the same as, or nested under, `root`. Cross-platform. */
function isContained(root: string, child: string): boolean {
  if (child === root) return true;
  const rel = relative(root, child);
  return rel !== "" &&
    rel !== ".." &&
    !apply(stringStartsWith, rel, [`..${PATH_SEP}`]) &&
    !isAbsolute(rel);
}

function isNativeNotFound(error: unknown): boolean {
  return apply(functionHasInstance, NativeNotFound, [error]) as boolean;
}

async function realPathIfExisting(path: string): Promise<string | null> {
  try {
    return await denoRealPath(path);
  } catch (error) {
    if (isNativeNotFound(error)) return null;
    throw new NativeError("Unable to canonicalize project path");
  }
}

async function realPathThroughExistingAncestor(path: string): Promise<string> {
  const unresolvedSegments: string[] = [];
  let candidate = path;

  while (true) {
    const realCandidate = await realPathIfExisting(candidate);
    if (realCandidate !== null) {
      let resolved = realCandidate;
      for (let index = unresolvedSegments.length - 1; index >= 0; index--) {
        resolved = resolvePath(resolved, unresolvedSegments[index]!);
      }
      return resolved;
    }

    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new NativeError("Unable to canonicalize project path");
    }
    const segment = basename(candidate);
    if (!segment || segment === "." || segment === "..") {
      throw new NativeError("Unable to canonicalize project path");
    }
    apply(arrayPush, unresolvedSegments, [segment]);
    candidate = parent;
  }
}

/**
 * Build a path guard that confines filesystem access to `projectDir`.
 *
 * Worker permissions restrict direct Deno filesystem reads to an explicit
 * allow-list, and this read-only `ctx.fs` adapter further confines framework
 * filesystem access to the project directory. The guard is both:
 *  - cross-platform (uses `relative()`, not a hard-coded `/` separator), and
 *  - symlink-safe (canonicalizes via `Deno.realPath` so a symlink inside the
 *    project that points outside it is rejected, not followed).
 */
export function makeProjectPathGuard(projectDir: string): (path: string) => Promise<string> {
  const root = resolvePath(projectDir);
  let realRootPromise: Promise<string> | null = null;

  return async (path: string): Promise<string> => {
    const resolved = resolvePath(root, path);

    // Lexical containment first — cheap, and catches plain `../` traversal
    // even when the target doesn't exist yet.
    if (!isContained(root, resolved)) {
      throw new NativeError(`Path escapes project directory: ${path}`);
    }

    // Canonicalize through the nearest existing ancestor so a missing target
    // beneath an existing symlink cannot escape through a lexical fallback.
    realRootPromise ??= (async () => {
      try {
        return await denoRealPath(root);
      } catch {
        throw new NativeError("Unable to canonicalize project root");
      }
    })();
    const realRoot = await realRootPromise;
    const realResolved = await realPathThroughExistingAncestor(resolved);
    if (!isContained(realRoot, realResolved)) {
      throw new NativeError(`Path escapes project directory: ${path}`);
    }

    return realResolved;
  };
}

// The host admits a trusted local extension module only for SSR workers. API
// workers never receive or resolve a renderer, and there is deliberately no
// implicit framework fallback.
let isolatedSsrRendererModuleUrl: string | null = null;
let isolatedSsrRendererPromise: Promise<Readonly<IsolatedSsrRenderer>> | null = null;

function rendererBoundaryError(stage: "import" | "initialization", cause: unknown): Error {
  const diagnostic = snapshotThrowableDiagnostic(cause);
  const message = diagnostic
    ? `Isolated SSR renderer extension ${stage} failed: ${diagnostic}`
    : `Isolated SSR renderer extension ${stage} failed`;
  return (stage === "import" ? IMPORT_RESOLUTION_ERROR : INITIALIZATION_ERROR).create({
    message,
    cause: diagnostic || "Unknown error",
  });
}

function snapshotIsolatedSsrRenderer(value: unknown): Readonly<IsolatedSsrRenderer> {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    isArray(value)
  ) {
    throw new NativeTypeError("Isolated SSR renderer factory must return a plain object");
  }
  const prototype = getPrototypeOf(value);
  if (prototype !== objectPrototype && prototype !== null) {
    throw new NativeTypeError("Isolated SSR renderer factory must return a plain object");
  }

  const renderer = value as Record<string, unknown>;
  const keys = objectKeys(renderer);
  const reflectedKeys = ownKeys(renderer);
  if (
    keys.length !== 2 ||
    reflectedKeys.length !== 2 ||
    !includesExpectedKey(keys, "createElement") ||
    !includesExpectedKey(keys, "renderToReadableStream")
  ) {
    throw new NativeTypeError(
      'Isolated SSR renderer must contain only "createElement" and "renderToReadableStream"',
    );
  }

  const createElementDescriptor = getOwnPropertyDescriptor(renderer, "createElement");
  const renderDescriptor = getOwnPropertyDescriptor(renderer, "renderToReadableStream");
  if (
    !createElementDescriptor?.enumerable ||
    !("value" in createElementDescriptor) ||
    typeof createElementDescriptor.value !== "function" ||
    isProxy(createElementDescriptor.value)
  ) {
    throw new NativeTypeError(
      "Isolated SSR renderer createElement must be a non-proxy function data property",
    );
  }
  if (
    !renderDescriptor?.enumerable ||
    !("value" in renderDescriptor) ||
    typeof renderDescriptor.value !== "function" ||
    isProxy(renderDescriptor.value)
  ) {
    throw new NativeTypeError(
      "Isolated SSR renderer renderToReadableStream must be a non-proxy function data property",
    );
  }

  return objectFreeze({
    createElement: createElementDescriptor.value as IsolatedSsrRenderer["createElement"],
    renderToReadableStream: renderDescriptor.value as IsolatedSsrRenderer["renderToReadableStream"],
  });
}

async function initializeIsolatedSsrRenderer(): Promise<Readonly<IsolatedSsrRenderer>> {
  const moduleUrl = isolatedSsrRendererModuleUrl;
  if (moduleUrl === null) {
    throw new NativeError(
      "Missing isolated SSR renderer extension. Install and register @veryfront/ext-react-ssr",
    );
  }

  let rendererModule: unknown;
  try {
    rendererModule = await import(moduleUrl);
  } catch (cause) {
    throw rendererBoundaryError("import", cause);
  }

  if (
    rendererModule === null ||
    typeof rendererModule !== "object" ||
    isProxy(rendererModule)
  ) {
    throw new NativeTypeError("Isolated SSR renderer extension must export a module object");
  }
  const moduleRecord = rendererModule as Record<string, unknown>;
  const moduleKeys = objectKeys(moduleRecord);
  const moduleReflectedKeys = ownKeys(moduleRecord);
  if (
    moduleKeys.length !== 1 ||
    moduleKeys[0] !== "createIsolatedSsrRenderer" ||
    moduleReflectedKeys.length !== 2 ||
    moduleReflectedKeys[0] !== "createIsolatedSsrRenderer" ||
    moduleReflectedKeys[1] !== Symbol.toStringTag
  ) {
    throw new NativeTypeError(
      'Isolated SSR renderer extension must export only "createIsolatedSsrRenderer"',
    );
  }
  const factoryDescriptor = getOwnPropertyDescriptor(
    moduleRecord,
    "createIsolatedSsrRenderer",
  );
  if (
    !factoryDescriptor?.enumerable ||
    !("value" in factoryDescriptor) ||
    typeof factoryDescriptor.value !== "function" ||
    isProxy(factoryDescriptor.value)
  ) {
    throw new NativeTypeError(
      "Isolated SSR renderer extension factory must be a non-proxy function data property",
    );
  }

  let renderer: unknown;
  try {
    renderer = apply(factoryDescriptor.value, undefined, []);
  } catch (cause) {
    throw rendererBoundaryError("initialization", cause);
  }
  return snapshotIsolatedSsrRenderer(renderer);
}

function getIsolatedSsrRenderer(): Promise<Readonly<IsolatedSsrRenderer>> {
  isolatedSsrRendererPromise ??= initializeIsolatedSsrRenderer();
  return isolatedSsrRendererPromise;
}

// ---------------------------------------------------------------------------
// Trusted Control-Channel Request Snapshots
// ---------------------------------------------------------------------------

type DataRecord = Record<string, unknown>;

interface DataSnapshotBudget {
  nodes: number;
  utf8Bytes: number;
}

interface StringSnapshotBudget {
  values: number;
  utf8Bytes: number;
  maxValues: number;
  maxUtf8Bytes: number;
}

function invalidWorkerRequest(field: string): never {
  const isSourceIntegrationPolicy = field === "sourceIntegrationPolicy" ||
    apply(stringStartsWith, field, ["sourceIntegrationPolicy."]);
  throw new NativeTypeError(
    isSourceIntegrationPolicy
      ? "Invalid source integration policy manifest"
      : `Invalid worker request ${field}`,
  );
}

function encodeUtf8(value: string): Uint8Array {
  return apply(encodeText, textEncoder, [value]) as Uint8Array;
}

function byteLengthOf(bytes: Uint8Array): number {
  if (!typedArrayByteLengthGetter) {
    throw new NativeError("Uint8Array byte length getter is unavailable");
  }
  return apply(typedArrayByteLengthGetter, bytes, []) as number;
}

function matches(pattern: RegExp, value: string): boolean {
  return apply(regexpTest, pattern, [value]) as boolean;
}

function requireString(
  value: unknown,
  field: string,
  maxChars = MAX_WORKER_VALUE_CHARS,
  allowEmpty = true,
): string {
  if (
    typeof value !== "string" ||
    value.length > maxChars ||
    (!allowEmpty && value.length === 0)
  ) {
    return invalidWorkerRequest(field);
  }
  return value;
}

function requirePlainDataRecord(
  value: unknown,
  field: string,
  maxEntries = MAX_WORKER_RECORD_ENTRIES,
): { record: DataRecord; keys: string[] } {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    isArray(value)
  ) {
    return invalidWorkerRequest(field);
  }

  const prototype = getPrototypeOf(value);
  if (prototype !== objectPrototype && prototype !== null) {
    return invalidWorkerRequest(field);
  }

  const record = value as DataRecord;
  const keys = objectKeys(record);
  const reflectedKeys = ownKeys(record);
  if (keys.length > maxEntries || reflectedKeys.length !== keys.length) {
    return invalidWorkerRequest(field);
  }

  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return invalidWorkerRequest(field);
    }
  }

  return { record, keys };
}

function includesExpectedKey(
  expected: readonly string[],
  key: string,
): boolean {
  for (let index = 0; index < expected.length; index++) {
    if (expected[index] === key) return true;
  }
  return false;
}

function requireRecordShape(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  field: string,
): DataRecord {
  const { record, keys } = requirePlainDataRecord(
    value,
    field,
    required.length + optional.length,
  );

  if (keys.length < required.length) return invalidWorkerRequest(field);

  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (
      !includesExpectedKey(required, key) &&
      !includesExpectedKey(optional, key)
    ) {
      return invalidWorkerRequest(field);
    }
  }
  for (let index = 0; index < required.length; index++) {
    const key = required[index]!;
    if (!getOwnPropertyDescriptor(record, key)) {
      return invalidWorkerRequest(field);
    }
  }

  return record;
}

function readDataProperty(record: DataRecord, key: string): unknown {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) {
    return invalidWorkerRequest(key);
  }
  return descriptor.value;
}

function readOptionalDataProperty(
  record: DataRecord,
  key: string,
): { present: false } | { present: true; value: unknown } {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor) return { present: false };
  if (!("value" in descriptor)) return invalidWorkerRequest(key);
  return { present: true, value: descriptor.value };
}

function requireDenseArray(
  value: unknown,
  field: string,
  maxLength = MAX_WORKER_RECORD_ENTRIES,
): unknown[] {
  if (
    !isArray(value) ||
    isProxy(value) ||
    getPrototypeOf(value) !== arrayPrototype
  ) {
    return invalidWorkerRequest(field);
  }

  const lengthDescriptor = getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof length !== "number" ||
    !numberIsSafeInteger(length) ||
    length < 0 ||
    length > maxLength
  ) {
    return invalidWorkerRequest(field);
  }

  const keys = objectKeys(value);
  const reflectedKeys = ownKeys(value);
  if (keys.length !== length || reflectedKeys.length !== length + 1) {
    return invalidWorkerRequest(field);
  }
  for (let index = 0; index < length; index++) {
    if (keys[index] !== NativeString(index)) {
      return invalidWorkerRequest(field);
    }
    const descriptor = getOwnPropertyDescriptor(value, keys[index]!);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return invalidWorkerRequest(field);
    }
  }

  return value as unknown[];
}

function arrayElement(values: unknown[], index: number, field: string): unknown {
  const descriptor = getOwnPropertyDescriptor(values, NativeString(index));
  if (!descriptor || !("value" in descriptor)) {
    return invalidWorkerRequest(field);
  }
  return descriptor.value;
}

function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function createNullPrototypeRecord<T>(): Record<string, T> {
  return apply(objectCreate, null, [null]) as Record<string, T>;
}

function freezeObject<T extends object>(value: T): T {
  return apply(objectFreeze, null, [value]) as T;
}

function createFrozenPolicyRestriction(
  allowedToolIds: readonly string[] | null,
): Readonly<{ allowedToolIds: readonly string[] | null }> {
  const restriction = createNullPrototypeRecord<unknown>();
  defineDataProperty(restriction, "allowedToolIds", allowedToolIds);
  return freezeObject(restriction) as Readonly<{
    allowedToolIds: readonly string[] | null;
  }>;
}

function createFrozenPolicyRoot(
  mode: "unrestricted",
): SourceIntegrationPolicyManifest;
function createFrozenPolicyRoot(
  mode: "allowlist",
  integrations: Readonly<
    Record<
      string,
      Readonly<{ allowedToolIds: readonly string[] | null }>
    >
  >,
): SourceIntegrationPolicyManifest;
function createFrozenPolicyRoot(
  mode: "unrestricted" | "allowlist",
  integrations?: Readonly<
    Record<
      string,
      Readonly<{ allowedToolIds: readonly string[] | null }>
    >
  >,
): SourceIntegrationPolicyManifest {
  const policy = createNullPrototypeRecord<unknown>();
  defineDataProperty(policy, "schemaVersion", 1);
  defineDataProperty(policy, "mode", mode);
  if (mode === "allowlist") {
    defineDataProperty(policy, "integrations", integrations);
  }
  return freezeObject(policy) as SourceIntegrationPolicyManifest;
}

function copyUint8Array(
  value: unknown,
  field: string,
  maxBytes: number,
): Uint8Array {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    getPrototypeOf(value) !== uint8ArrayPrototype ||
    !typedArrayByteLengthGetter
  ) {
    return invalidWorkerRequest(field);
  }

  let byteLength: number;
  let copy: Uint8Array;
  try {
    byteLength = apply(typedArrayByteLengthGetter, value, []) as number;
    if (byteLength > maxBytes) return invalidWorkerRequest(field);
    copy = new NativeUint8Array(byteLength);
    apply(setBytes, copy, [value]);
  } catch {
    return invalidWorkerRequest(field);
  }
  if (byteLength !== apply(typedArrayByteLengthGetter, copy, [])) {
    return invalidWorkerRequest(field);
  }
  return copy;
}

function snapshotPreparedWorkerModule(value: unknown): PreparedWorkerModule {
  const record = requireRecordShape(
    value,
    ["source", "sha256"],
    [],
    "module",
  );
  const source = requireString(
    readDataProperty(record, "source"),
    "module.source",
    MAX_SAFE_INTEGER,
  );
  const sha256 = requireString(
    readDataProperty(record, "sha256"),
    "module.sha256",
    64,
    false,
  );
  if (
    !matches(LOWERCASE_SHA256_PATTERN, sha256) ||
    byteLengthOf(encodeUtf8(source)) > MAX_WORKER_MODULE_SOURCE_BYTES
  ) {
    return invalidWorkerRequest("module");
  }
  return { source, sha256 };
}

function snapshotWorkerApplicationIdentity(value: unknown): ApplicationIdentity | null {
  if (value === null) return null;
  try {
    return snapshotApplicationIdentity(value);
  } catch {
    return invalidWorkerRequest("applicationIdentity");
  }
}

function prevalidateWorkerRequestApplicationIdentity(value: unknown): void {
  const envelope = requirePlainDataRecord(value, "payload", 16).record;
  const type = requireString(
    readDataProperty(envelope, "type"),
    "type",
    64,
    false,
  );

  if (type === "execute-app-route") {
    const applicationIdentity = readOptionalDataProperty(
      envelope,
      "applicationIdentity",
    );
    if (!applicationIdentity.present) {
      return invalidWorkerRequest("applicationIdentity");
    }
    snapshotWorkerApplicationIdentity(applicationIdentity.value);
    return;
  }

  if (type === "execute-pages-route") {
    const applicationIdentity = readOptionalDataProperty(
      envelope,
      "applicationIdentity",
    );
    if (!applicationIdentity.present) {
      return invalidWorkerRequest("applicationIdentity");
    }
    snapshotWorkerApplicationIdentity(applicationIdentity.value);
  }
}

function snapshotStringArray(
  value: unknown,
  field: string,
  maxLength = MAX_WORKER_RECORD_ENTRIES,
  maxStringChars = MAX_WORKER_VALUE_CHARS,
  budget?: StringSnapshotBudget,
): string[] {
  const input = requireDenseArray(value, field, maxLength);
  const output = new NativeArray<string>(input.length);
  for (let index = 0; index < input.length; index++) {
    const stringValue = requireString(
      arrayElement(input, index, field),
      field,
      maxStringChars,
    );
    if (budget) consumeStringBudget(budget, stringValue, field);
    defineDataProperty(
      output,
      NativeString(index),
      stringValue,
    );
  }
  return output;
}

function consumeStringBudget(
  budget: StringSnapshotBudget,
  value: string,
  field: string,
): void {
  budget.values++;
  budget.utf8Bytes += byteLengthOf(encodeUtf8(value));
  if (
    budget.values > budget.maxValues ||
    budget.utf8Bytes > budget.maxUtf8Bytes
  ) {
    invalidWorkerRequest(field);
  }
}

function snapshotStringRecord(
  value: unknown,
  field: string,
  valueMayBeArray: false,
  maxUtf8Bytes?: number,
  maxValues?: number,
): Record<string, string>;
function snapshotStringRecord(
  value: unknown,
  field: string,
  valueMayBeArray: true,
  maxUtf8Bytes?: number,
  maxValues?: number,
): Record<string, string | string[]>;
function snapshotStringRecord(
  value: unknown,
  field: string,
  valueMayBeArray: boolean,
  maxUtf8Bytes = MAX_WORKER_STRING_COLLECTION_UTF8_BYTES,
  maxValues = MAX_WORKER_STRING_COLLECTION_VALUES,
): Record<string, string | string[]> {
  const { record, keys } = requirePlainDataRecord(value, field);
  const output: Record<string, string | string[]> = {};
  const budget: StringSnapshotBudget = {
    values: 0,
    utf8Bytes: 0,
    maxValues,
    maxUtf8Bytes,
  };

  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    requireString(key, field, MAX_WORKER_VALUE_CHARS);
    consumeStringBudget(budget, key, field);
    const raw = readDataProperty(record, key);
    const copied = valueMayBeArray && isArray(raw)
      ? snapshotStringArray(
        raw,
        field,
        MAX_WORKER_RECORD_ENTRIES,
        MAX_WORKER_VALUE_CHARS,
        budget,
      )
      : requireString(raw, field);
    if (typeof copied === "string") {
      consumeStringBudget(budget, copied, field);
    }
    defineDataProperty(output, key, copied);
  }
  return output;
}

function snapshotProjectEnv(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const env = snapshotStringRecord(
    value,
    "projectEnv",
    false,
    MAX_WORKER_PROJECT_ENV_UTF8_BYTES,
  );
  const keys = objectKeys(env);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const envValue = env[key]!;
    if (
      key.length > 1024 ||
      !matches(PROJECT_ENV_KEY_PATTERN, key) ||
      !matches(PROJECT_ENV_VALUE_PATTERN, envValue)
    ) {
      return invalidWorkerRequest("projectEnv");
    }
  }
  return env;
}

function snapshotSourceIntegrationPolicy(
  value: unknown,
): SourceIntegrationPolicyManifest {
  const common = requireRecordShape(
    value,
    ["schemaVersion", "mode"],
    ["integrations"],
    "sourceIntegrationPolicy",
  );
  if (
    readDataProperty(common, "schemaVersion") !== 1
  ) {
    return invalidWorkerRequest("sourceIntegrationPolicy");
  }

  const mode = readDataProperty(common, "mode");
  const integrationsField = readOptionalDataProperty(common, "integrations");
  if (mode === "unrestricted") {
    if (integrationsField.present) {
      return invalidWorkerRequest("sourceIntegrationPolicy");
    }
    return createFrozenPolicyRoot("unrestricted");
  }
  if (mode !== "allowlist" || !integrationsField.present) {
    return invalidWorkerRequest("sourceIntegrationPolicy");
  }

  const { record: rawIntegrations, keys: integrationNames } = requirePlainDataRecord(
    integrationsField.value,
    "sourceIntegrationPolicy.integrations",
  );
  apply(arraySort, integrationNames, [compareStrings]);
  const integrations: Record<
    string,
    Readonly<{ readonly allowedToolIds: readonly string[] | null }>
  > = createNullPrototypeRecord();
  const policyBudget: StringSnapshotBudget = {
    values: 0,
    utf8Bytes: 0,
    maxValues: MAX_WORKER_STRING_COLLECTION_VALUES,
    maxUtf8Bytes: MAX_WORKER_POLICY_UTF8_BYTES,
  };

  for (let integrationIndex = 0; integrationIndex < integrationNames.length; integrationIndex++) {
    const integrationName = requireString(
      integrationNames[integrationIndex],
      "sourceIntegrationPolicy.integrations",
      MAX_WORKER_POLICY_SEGMENT_CHARS,
      false,
    );
    consumeStringBudget(
      policyBudget,
      integrationName,
      "sourceIntegrationPolicy",
    );
    if (!matches(CANONICAL_POLICY_SEGMENT_PATTERN, integrationName)) {
      return invalidWorkerRequest("sourceIntegrationPolicy.integrations");
    }
    const restriction = requireRecordShape(
      readDataProperty(rawIntegrations, integrationName),
      ["allowedToolIds"],
      [],
      "sourceIntegrationPolicy.integrations",
    );
    const rawToolIds = readDataProperty(restriction, "allowedToolIds");
    let allowedToolIds: string[] | null = null;
    if (rawToolIds !== null) {
      allowedToolIds = snapshotStringArray(
        rawToolIds,
        "sourceIntegrationPolicy.allowedToolIds",
        MAX_WORKER_RECORD_ENTRIES,
        MAX_WORKER_POLICY_SEGMENT_CHARS,
        policyBudget,
      );
      const seenToolIds = new NativeSet<string>();
      for (let index = 0; index < allowedToolIds.length; index++) {
        const toolId = allowedToolIds[index]!;
        if (!matches(CANONICAL_POLICY_SEGMENT_PATTERN, toolId)) {
          return invalidWorkerRequest("sourceIntegrationPolicy.allowedToolIds");
        }
        if (apply(setHas, seenToolIds, [toolId])) {
          return invalidWorkerRequest(
            "sourceIntegrationPolicy.allowedToolIds",
          );
        }
        apply(setAdd, seenToolIds, [toolId]);
      }
      apply(arraySort, allowedToolIds, [compareStrings]);
      freezeObject(allowedToolIds);
    }
    defineDataProperty(
      integrations,
      integrationName,
      createFrozenPolicyRestriction(allowedToolIds),
    );
  }

  return createFrozenPolicyRoot(
    "allowlist",
    freezeObject(integrations),
  );
}

function snapshotRequiredSourceIntegrationPolicy(
  request: DataRecord,
): SourceIntegrationPolicyManifest {
  const field = readOptionalDataProperty(
    request,
    "sourceIntegrationPolicy",
  );
  if (!field.present) return invalidWorkerRequest("sourceIntegrationPolicy");
  return snapshotSourceIntegrationPolicy(field.value);
}

function snapshotHeaders(value: unknown): [string, string][] {
  const rawHeaders = requireDenseArray(
    value,
    "headers",
    MAX_WORKER_HEADER_COUNT,
  );
  const headers = new NativeArray<[string, string]>(rawHeaders.length);
  const budget: StringSnapshotBudget = {
    values: 0,
    utf8Bytes: 0,
    maxValues: MAX_WORKER_HEADER_COUNT * 2,
    maxUtf8Bytes: MAX_WORKER_HEADER_UTF8_BYTES,
  };

  for (let index = 0; index < rawHeaders.length; index++) {
    const rawPair = requireDenseArray(
      arrayElement(rawHeaders, index, "headers"),
      "header",
      2,
    );
    if (rawPair.length !== 2) return invalidWorkerRequest("header");
    const name = requireString(
      arrayElement(rawPair, 0, "header"),
      "header.name",
      MAX_WORKER_HEADER_FIELD_CHARS,
    );
    const headerValue = requireString(
      arrayElement(rawPair, 1, "header"),
      "header.value",
      MAX_WORKER_HEADER_FIELD_CHARS,
    );
    consumeStringBudget(budget, name, "headers");
    consumeStringBudget(budget, headerValue, "headers");
    const pair: [string, string] = [
      name,
      headerValue,
    ];
    defineDataProperty(headers, NativeString(index), pair);
  }
  return headers;
}

function snapshotSerializedRequest(value: unknown): SerializedRequest {
  const record = requireRecordShape(
    value,
    ["url", "method", "headers", "body"],
    [],
    "request",
  );
  const rawBody = readDataProperty(record, "body");
  return {
    url: requireString(
      readDataProperty(record, "url"),
      "request.url",
      MAX_WORKER_URL_CHARS,
      false,
    ),
    method: requireString(
      readDataProperty(record, "method"),
      "request.method",
      64,
      false,
    ),
    headers: snapshotHeaders(readDataProperty(record, "headers")),
    body: rawBody === null ? null : copyUint8Array(rawBody, "request.body", MAX_WORKER_BODY_BYTES),
  };
}

function snapshotPagesContext(value: unknown): SerializedPagesContext {
  const record = requireRecordShape(
    value,
    ["url", "method", "headers", "body", "params", "cookies"],
    [],
    "context",
  );
  const request = snapshotSerializedRequest({
    url: readDataProperty(record, "url"),
    method: readDataProperty(record, "method"),
    headers: readDataProperty(record, "headers"),
    body: readDataProperty(record, "body"),
  });
  return {
    ...request,
    params: snapshotStringRecord(
      readDataProperty(record, "params"),
      "context.params",
      true,
    ),
    cookies: snapshotStringRecord(
      readDataProperty(record, "cookies"),
      "context.cookies",
      false,
    ) as Record<string, string>,
  };
}

function snapshotDataContext(value: unknown): SerializedDataContext {
  const record = requireRecordShape(
    value,
    ["params", "query", "request", "url"],
    ["applicationIdentity"],
    "context",
  );
  const applicationIdentity = readOptionalDataProperty(
    record,
    "applicationIdentity",
  );
  return {
    params: snapshotStringRecord(
      readDataProperty(record, "params"),
      "context.params",
      true,
    ),
    query: requireString(
      readDataProperty(record, "query"),
      "context.query",
      MAX_WORKER_URL_CHARS,
    ),
    request: snapshotSerializedRequest(readDataProperty(record, "request")),
    url: requireString(
      readDataProperty(record, "url"),
      "context.url",
      MAX_WORKER_URL_CHARS,
      false,
    ),
    applicationIdentity: applicationIdentity.present
      ? snapshotWorkerApplicationIdentity(applicationIdentity.value)
      : null,
  };
}

function consumeDataBudget(
  budget: DataSnapshotBudget,
  value: string,
): void {
  budget.nodes++;
  budget.utf8Bytes += byteLengthOf(encodeUtf8(value));
  if (
    budget.nodes > MAX_WORKER_DATA_NODES ||
    budget.utf8Bytes > MAX_WORKER_DATA_UTF8_BYTES
  ) {
    invalidWorkerRequest("render data");
  }
}

function snapshotStructuredData(
  value: unknown,
  budget: DataSnapshotBudget,
  depth = 0,
): unknown {
  if (depth > MAX_WORKER_DATA_DEPTH) {
    return invalidWorkerRequest("render data");
  }
  if (value === null || typeof value === "boolean") {
    budget.nodes++;
    if (budget.nodes > MAX_WORKER_DATA_NODES) {
      return invalidWorkerRequest("render data");
    }
    return value;
  }
  if (typeof value === "string") {
    consumeDataBudget(budget, value);
    return value;
  }
  if (typeof value === "number") {
    budget.nodes++;
    if (
      budget.nodes > MAX_WORKER_DATA_NODES ||
      !numberIsFinite(value)
    ) {
      return invalidWorkerRequest("render data");
    }
    return value;
  }
  if (isArray(value)) {
    const input = requireDenseArray(
      value,
      "render data",
      MAX_WORKER_DATA_NODES,
    );
    budget.nodes++;
    if (budget.nodes > MAX_WORKER_DATA_NODES) {
      return invalidWorkerRequest("render data");
    }
    const output = new NativeArray<unknown>(input.length);
    for (let index = 0; index < input.length; index++) {
      defineDataProperty(
        output,
        NativeString(index),
        snapshotStructuredData(
          arrayElement(input, index, "render data"),
          budget,
          depth + 1,
        ),
      );
    }
    return output;
  }
  if (typeof value !== "object") {
    return invalidWorkerRequest("render data");
  }

  const { record, keys } = requirePlainDataRecord(
    value,
    "render data",
    MAX_WORKER_DATA_NODES,
  );
  budget.nodes++;
  if (budget.nodes > MAX_WORKER_DATA_NODES) {
    return invalidWorkerRequest("render data");
  }
  const output: Record<string, unknown> = {};
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    consumeDataBudget(budget, key);
    defineDataProperty(
      output,
      key,
      snapshotStructuredData(
        readDataProperty(record, key),
        budget,
        depth + 1,
      ),
    );
  }
  return output;
}

function snapshotStructuredDataRecord(
  value: unknown,
  budget: DataSnapshotBudget,
): Record<string, unknown> {
  const snapshot = snapshotStructuredData(value, budget);
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    isArray(snapshot)
  ) {
    return invalidWorkerRequest("render data");
  }
  return snapshot as Record<string, unknown>;
}

function invalidIsolatedDataResult(): never {
  throw new NativeTypeError("Invalid isolated data result");
}

const MAX_WORKER_RESPONSE_METADATA_ENTRIES = 64;

function snapshotDataResponseHeaders(value: unknown): Record<string, string> {
  return snapshotStringRecord(
    value,
    "data result headers",
    false,
    MAX_WORKER_HEADER_UTF8_BYTES,
    MAX_WORKER_RESPONSE_METADATA_ENTRIES * 2,
  );
}

function snapshotDataResponseCookies(
  value: unknown,
): NonNullable<SerializedDataResult["cookies"]> {
  const input = requireDenseArray(
    value,
    "data result cookies",
    MAX_WORKER_RESPONSE_METADATA_ENTRIES,
  );
  const output = new NativeArray<NonNullable<SerializedDataResult["cookies"]>[number]>(
    input.length,
  );
  const optional = [
    "domain",
    "path",
    "expires",
    "maxAge",
    "httpOnly",
    "secure",
    "sameSite",
  ] as const;

  for (let index = 0; index < input.length; index++) {
    const record = requireRecordShape(
      arrayElement(input, index, "data result cookies"),
      ["name", "value"],
      optional,
      "data result cookie",
    );
    const cookie: NonNullable<SerializedDataResult["cookies"]>[number] = {
      name: requireString(readDataProperty(record, "name"), "data result cookie name"),
      value: requireString(readDataProperty(record, "value"), "data result cookie value"),
    };

    const domain = snapshotOptionalString(record, "domain", MAX_WORKER_VALUE_CHARS);
    const path = snapshotOptionalString(record, "path", MAX_WORKER_VALUE_CHARS);
    const expires = snapshotOptionalString(record, "expires", MAX_WORKER_VALUE_CHARS);
    const sameSite = snapshotOptionalString(record, "sameSite", 6);
    if (domain !== undefined) cookie.domain = domain;
    if (path !== undefined) cookie.path = path;
    if (expires !== undefined) cookie.expires = expires;
    if (sameSite !== undefined) {
      if (sameSite !== "lax" && sameSite !== "strict" && sameSite !== "none") {
        return invalidIsolatedDataResult();
      }
      cookie.sameSite = sameSite;
    }
    const maxAge = readOptionalDataProperty(record, "maxAge");
    if (maxAge.present && maxAge.value !== undefined) {
      if (typeof maxAge.value !== "number" || !numberIsSafeInteger(maxAge.value)) {
        return invalidIsolatedDataResult();
      }
      cookie.maxAge = maxAge.value;
    }
    for (const key of ["httpOnly", "secure"] as const) {
      const field = readOptionalDataProperty(record, key);
      if (field.present && field.value !== undefined) {
        if (typeof field.value !== "boolean") return invalidIsolatedDataResult();
        cookie[key] = field.value;
      }
    }
    defineDataProperty(output, NativeString(index), cookie);
  }

  return output;
}

function snapshotDataResultForBoundary(value: unknown): SerializedDataResult {
  try {
    const { record: result } = requirePlainDataRecord(
      value,
      "data result",
    );
    const rawProps = readOptionalDataProperty(result, "props");
    const rawRedirect = readOptionalDataProperty(result, "redirect");
    const rawNotFound = readOptionalDataProperty(result, "notFound");
    const rawRevalidate = readOptionalDataProperty(result, "revalidate");
    const rawHeaders = readOptionalDataProperty(result, "headers");
    const rawCookies = readOptionalDataProperty(result, "cookies");
    const hasProps = rawProps.present && rawProps.value !== undefined;
    const hasRedirect = rawRedirect.present && rawRedirect.value !== undefined;
    const hasNotFound = rawNotFound.present && rawNotFound.value !== undefined;
    const hasRevalidate = rawRevalidate.present && rawRevalidate.value !== undefined;
    const hasHeaders = rawHeaders.present && rawHeaders.value !== undefined;
    const hasCookies = rawCookies.present && rawCookies.value !== undefined;

    let normalizedRedirect:
      | { destination: string; permanent?: boolean }
      | undefined;
    if (hasRedirect) {
      const { record: redirectRecord } = requirePlainDataRecord(
        rawRedirect.value,
        "data result redirect",
      );
      const destinationField = readOptionalDataProperty(
        redirectRecord,
        "destination",
      );
      if (!destinationField.present) return invalidIsolatedDataResult();
      const destination = requireString(
        destinationField.value,
        "data result redirect destination",
        MAX_WORKER_URL_CHARS,
        true,
      );
      const permanent = readOptionalDataProperty(redirectRecord, "permanent");
      const hasPermanent = permanent.present && permanent.value !== undefined;
      if (hasPermanent && typeof permanent.value !== "boolean") {
        return invalidIsolatedDataResult();
      }
      normalizedRedirect = {
        destination,
        ...(hasPermanent ? { permanent: permanent.value as boolean } : {}),
      };
    }

    if (hasNotFound && typeof rawNotFound.value !== "boolean") {
      return invalidIsolatedDataResult();
    }
    const normalizedNotFound = hasNotFound ? rawNotFound.value as boolean : undefined;

    const normalized: Record<string, unknown> = {};
    if (normalizedRedirect) {
      defineDataProperty(normalized, "redirect", normalizedRedirect);
    } else if (normalizedNotFound === true) {
      defineDataProperty(normalized, "notFound", true);
    } else {
      let normalizedRevalidate: number | false | undefined;
      if (hasRevalidate) {
        if (
          rawRevalidate.value !== false &&
          (typeof rawRevalidate.value !== "number" ||
            !numberIsFinite(rawRevalidate.value) ||
            rawRevalidate.value < 0)
        ) {
          return invalidIsolatedDataResult();
        }
        normalizedRevalidate = rawRevalidate.value as number | false;
      }
      if (hasProps) defineDataProperty(normalized, "props", rawProps.value);
      if (normalizedNotFound !== undefined) {
        defineDataProperty(normalized, "notFound", normalizedNotFound);
      }
      if (normalizedRevalidate !== undefined) {
        defineDataProperty(normalized, "revalidate", normalizedRevalidate);
      }
    }
    if (hasHeaders) {
      defineDataProperty(
        normalized,
        "headers",
        snapshotDataResponseHeaders(rawHeaders.value),
      );
    }
    if (hasCookies) {
      defineDataProperty(
        normalized,
        "cookies",
        snapshotDataResponseCookies(rawCookies.value),
      );
    }
    const budget: DataSnapshotBudget = { nodes: 0, utf8Bytes: 0 };
    return snapshotStructuredDataRecord(normalized, budget) as SerializedDataResult;
  } catch {
    return invalidIsolatedDataResult();
  }
}

function snapshotOptionalString(
  record: DataRecord,
  key: string,
  maxChars: number,
): string | undefined {
  const field = readOptionalDataProperty(record, key);
  if (!field.present || field.value === undefined) return undefined;
  return requireString(field.value, key, maxChars);
}

function snapshotSSRDependencyPinning(
  request: DataRecord,
): Pick<
  RenderSSRRequest,
  "dependencyPinningCacheKey" | "dependencyPinningDependencies"
> {
  const cacheKeyField = readOptionalDataProperty(
    request,
    "dependencyPinningCacheKey",
  );
  const dependenciesField = readOptionalDataProperty(
    request,
    "dependencyPinningDependencies",
  );
  const rawCacheKey = cacheKeyField.present ? cacheKeyField.value : undefined;
  const rawDependencies = dependenciesField.present ? dependenciesField.value : undefined;

  if (rawCacheKey === undefined && rawDependencies === undefined) return {};
  const cacheKey = requireString(
    rawCacheKey,
    "dependencyPinningCacheKey",
    16,
    false,
  );
  if (cacheKey === "off") {
    if (rawDependencies !== undefined) {
      return invalidWorkerRequest("dependencyPinningDependencies");
    }
    return { dependencyPinningCacheKey: cacheKey };
  }

  const match = apply(
    regexpExec,
    CANONICAL_DEPENDENCY_PINNING_CACHE_KEY_PATTERN,
    [cacheKey],
  ) as RegExpExecArray | null;
  const hash = match?.[1];
  if (
    cacheKey === "on:unknown" ||
    cacheKey === "on:no-project" ||
    !hash ||
    (hash.length === MAX_DEPENDENCY_PINNING_HASH.length &&
      hash > MAX_DEPENDENCY_PINNING_HASH) ||
    rawDependencies === undefined
  ) {
    return invalidWorkerRequest("dependencyPinningCacheKey");
  }

  const { record, keys } = requirePlainDataRecord(
    rawDependencies,
    "dependencyPinningDependencies",
  );
  apply(arraySort, keys, [compareStrings]);
  const dependencies = createNullPrototypeRecord<string>();
  const budget: StringSnapshotBudget = {
    values: 0,
    utf8Bytes: 0,
    maxValues: MAX_WORKER_RECORD_ENTRIES * 2,
    maxUtf8Bytes: MAX_WORKER_PROJECT_ENV_UTF8_BYTES,
  };
  for (let index = 0; index < keys.length; index++) {
    const name = requireString(
      keys[index],
      "dependencyPinningDependencies",
      MAX_WORKER_VALUE_CHARS,
      false,
    );
    const declaration = requireString(
      readDataProperty(record, name),
      "dependencyPinningDependencies",
    );
    consumeStringBudget(budget, name, "dependencyPinningDependencies");
    consumeStringBudget(
      budget,
      declaration,
      "dependencyPinningDependencies",
    );
    defineDataProperty(dependencies, name, declaration);
  }

  return {
    dependencyPinningCacheKey: cacheKey,
    dependencyPinningDependencies: freezeObject(dependencies),
  };
}

/**
 * The bundled worker renderer has one fixed React implementation. Until the
 * extension can select a renderer by canonical dependency snapshot, accepting
 * an enabled host snapshot would silently render with the wrong React graph.
 */
export function assertIsolatedSsrDependencySnapshotSupported(
  request: RenderSSRRequest,
): void {
  if (
    request.dependencyPinningCacheKey === undefined ||
    request.dependencyPinningCacheKey === "off"
  ) {
    return;
  }
  throw new NativeError(
    "Isolated SSR does not support enabled dependency snapshots",
  );
}

/**
 * Synchronously detach and validate one control-port request before it can be
 * observed or mutated by any later project task.
 *
 * @internal Exported for deterministic boundary regression tests.
 */
export function snapshotWorkerRequest(value: unknown): WorkerRequest {
  prevalidateWorkerRequestApplicationIdentity(value);

  let cloned: unknown;
  try {
    cloned = cloneStructuredValue(value);
  } catch {
    return invalidWorkerRequest("payload");
  }

  const envelope = requirePlainDataRecord(cloned, "payload", 16).record;
  const type = requireString(
    readDataProperty(envelope, "type"),
    "type",
    64,
    false,
  );

  if (type === "execute-app-route") {
    const sourceIntegrationPolicy = snapshotRequiredSourceIntegrationPolicy(
      envelope,
    );
    const request = requireRecordShape(
      cloned,
      [
        "type",
        "id",
        "module",
        "modulePath",
        "method",
        "request",
        "params",
        "projectDir",
        "sourceIntegrationPolicy",
      ],
      ["projectEnv", "applicationIdentity"],
      "payload",
    );
    const applicationIdentity = readOptionalDataProperty(
      request,
      "applicationIdentity",
    );
    if (!applicationIdentity.present) {
      return invalidWorkerRequest("applicationIdentity");
    }
    return {
      type,
      id: requireString(
        readDataProperty(request, "id"),
        "id",
        MAX_WORKER_REQUEST_ID_CHARS,
        false,
      ),
      module: snapshotPreparedWorkerModule(
        readDataProperty(request, "module"),
      ),
      modulePath: requireString(
        readDataProperty(request, "modulePath"),
        "modulePath",
        MAX_WORKER_PATH_CHARS,
        false,
      ),
      method: requireString(
        readDataProperty(request, "method"),
        "method",
        64,
        false,
      ),
      request: snapshotSerializedRequest(
        readDataProperty(request, "request"),
      ),
      params: snapshotStringRecord(
        readDataProperty(request, "params"),
        "params",
        false,
      ),
      projectDir: requireString(
        readDataProperty(request, "projectDir"),
        "projectDir",
        MAX_WORKER_PATH_CHARS,
        false,
      ),
      sourceIntegrationPolicy,
      projectEnv: snapshotProjectEnv(
        readOptionalDataProperty(request, "projectEnv").present
          ? readDataProperty(request, "projectEnv")
          : undefined,
      ),
      applicationIdentity: snapshotWorkerApplicationIdentity(
        applicationIdentity.value,
      ),
    };
  }

  if (type === "execute-pages-route") {
    const sourceIntegrationPolicy = snapshotRequiredSourceIntegrationPolicy(
      envelope,
    );
    const request = requireRecordShape(
      cloned,
      [
        "type",
        "id",
        "module",
        "modulePath",
        "method",
        "context",
        "projectDir",
        "sourceIntegrationPolicy",
      ],
      ["projectEnv", "applicationIdentity"],
      "payload",
    );
    const applicationIdentity = readOptionalDataProperty(
      request,
      "applicationIdentity",
    );
    if (!applicationIdentity.present) {
      return invalidWorkerRequest("applicationIdentity");
    }
    return {
      type,
      id: requireString(
        readDataProperty(request, "id"),
        "id",
        MAX_WORKER_REQUEST_ID_CHARS,
        false,
      ),
      module: snapshotPreparedWorkerModule(
        readDataProperty(request, "module"),
      ),
      modulePath: requireString(
        readDataProperty(request, "modulePath"),
        "modulePath",
        MAX_WORKER_PATH_CHARS,
        false,
      ),
      method: requireString(
        readDataProperty(request, "method"),
        "method",
        64,
        false,
      ),
      context: snapshotPagesContext(readDataProperty(request, "context")),
      projectDir: requireString(
        readDataProperty(request, "projectDir"),
        "projectDir",
        MAX_WORKER_PATH_CHARS,
        false,
      ),
      sourceIntegrationPolicy,
      projectEnv: snapshotProjectEnv(
        readOptionalDataProperty(request, "projectEnv").present
          ? readDataProperty(request, "projectEnv")
          : undefined,
      ),
      applicationIdentity: snapshotWorkerApplicationIdentity(
        applicationIdentity.value,
      ),
    };
  }

  if (type === "inspect-api-route-methods") {
    const sourceIntegrationPolicy = snapshotRequiredSourceIntegrationPolicy(
      envelope,
    );
    const request = requireRecordShape(
      cloned,
      [
        "type",
        "id",
        "module",
        "modulePath",
        "projectDir",
        "sourceIntegrationPolicy",
      ],
      ["requestedMethod", "includeFrameworkOptions", "projectEnv"],
      "payload",
    );
    return {
      type,
      id: requireString(
        readDataProperty(request, "id"),
        "id",
        MAX_WORKER_REQUEST_ID_CHARS,
        false,
      ),
      module: snapshotPreparedWorkerModule(
        readDataProperty(request, "module"),
      ),
      modulePath: requireString(
        readDataProperty(request, "modulePath"),
        "modulePath",
        MAX_WORKER_PATH_CHARS,
        false,
      ),
      requestedMethod: snapshotOptionalString(
        request,
        "requestedMethod",
        64,
      ),
      includeFrameworkOptions: (() => {
        const field = readOptionalDataProperty(request, "includeFrameworkOptions");
        if (!field.present) return undefined;
        if (typeof field.value !== "boolean") {
          throw new NativeTypeError(
            "Invalid worker request includeFrameworkOptions",
          );
        }
        return field.value;
      })(),
      projectDir: requireString(
        readDataProperty(request, "projectDir"),
        "projectDir",
        MAX_WORKER_PATH_CHARS,
        false,
      ),
      sourceIntegrationPolicy,
      projectEnv: snapshotProjectEnv(
        readOptionalDataProperty(request, "projectEnv").present
          ? readDataProperty(request, "projectEnv")
          : undefined,
      ),
    };
  }

  if (type === "fetch-data") {
    const sourceIntegrationPolicy = snapshotRequiredSourceIntegrationPolicy(
      envelope,
    );
    const request = requireRecordShape(
      cloned,
      [
        "type",
        "id",
        "modulePath",
        "context",
        "sourceIntegrationPolicy",
      ],
      ["projectEnv"],
      "payload",
    );
    return {
      type,
      id: requireString(
        readDataProperty(request, "id"),
        "id",
        MAX_WORKER_REQUEST_ID_CHARS,
        false,
      ),
      modulePath: requireString(
        readDataProperty(request, "modulePath"),
        "modulePath",
        MAX_WORKER_PATH_CHARS,
        false,
      ),
      context: snapshotDataContext(readDataProperty(request, "context")),
      sourceIntegrationPolicy,
      projectEnv: snapshotProjectEnv(
        readOptionalDataProperty(request, "projectEnv").present
          ? readDataProperty(request, "projectEnv")
          : undefined,
      ),
    };
  }

  if (type === "render-ssr") {
    const sourceIntegrationPolicy = snapshotRequiredSourceIntegrationPolicy(
      envelope,
    );
    const request = requireRecordShape(
      cloned,
      [
        "type",
        "id",
        "pageModulePath",
        "layoutModulePaths",
        "pageProps",
        "layoutProps",
        "delivery",
        "sourceIntegrationPolicy",
      ],
      [
        "dependencyPinningCacheKey",
        "dependencyPinningDependencies",
      ],
      "payload",
    );
    const budget: DataSnapshotBudget = { nodes: 0, utf8Bytes: 0 };
    const layoutPathBudget: StringSnapshotBudget = {
      values: 0,
      utf8Bytes: 0,
      maxValues: MAX_WORKER_RECORD_ENTRIES,
      maxUtf8Bytes: MAX_WORKER_STRING_COLLECTION_UTF8_BYTES,
    };
    const layoutModulePaths = snapshotStringArray(
      readDataProperty(request, "layoutModulePaths"),
      "layoutModulePaths",
      MAX_WORKER_RECORD_ENTRIES,
      MAX_WORKER_PATH_CHARS,
      layoutPathBudget,
    );
    const rawLayoutProps = requireDenseArray(
      readDataProperty(request, "layoutProps"),
      "layoutProps",
      MAX_WORKER_RECORD_ENTRIES,
    );
    if (rawLayoutProps.length !== layoutModulePaths.length) {
      return invalidWorkerRequest("layoutProps");
    }
    const layoutProps = new NativeArray<Record<string, unknown>>(
      rawLayoutProps.length,
    );
    for (let index = 0; index < rawLayoutProps.length; index++) {
      defineDataProperty(
        layoutProps,
        NativeString(index),
        snapshotStructuredDataRecord(
          arrayElement(rawLayoutProps, index, "layoutProps"),
          budget,
        ),
      );
    }
    const delivery = readDataProperty(request, "delivery");
    if (delivery !== "string" && delivery !== "stream") {
      return invalidWorkerRequest("delivery");
    }
    const dependencyPinning = snapshotSSRDependencyPinning(request);
    return {
      type,
      id: requireString(
        readDataProperty(request, "id"),
        "id",
        MAX_WORKER_REQUEST_ID_CHARS,
        false,
      ),
      pageModulePath: requireString(
        readDataProperty(request, "pageModulePath"),
        "pageModulePath",
        MAX_WORKER_PATH_CHARS,
        false,
      ),
      layoutModulePaths,
      pageProps: snapshotStructuredDataRecord(
        readDataProperty(request, "pageProps"),
        budget,
      ),
      layoutProps,
      delivery,
      ...dependencyPinning,
      sourceIntegrationPolicy,
    };
  }

  return invalidWorkerRequest("type");
}

// ---------------------------------------------------------------------------
// Serialization Helpers
// ---------------------------------------------------------------------------

function deserializeRequest(s: SerializedRequest): Request {
  return new NativeRequest(s.url, {
    method: s.method,
    headers: s.headers,
    body: s.body as BodyInit | null,
  });
}

function deserializePagesRequest(
  s: SerializedPagesContext,
): {
  request: Request;
  params: Record<string, string | string[]>;
  cookies: Record<string, string>;
} {
  const request = new NativeRequest(s.url, {
    method: s.method,
    headers: s.headers,
    body: s.body as BodyInit | null,
  });
  return { request, params: s.params, cookies: s.cookies };
}

async function serializeResponse(
  response: unknown,
  requestMethod?: string,
): Promise<SerializedResponse> {
  return await serializeRouteResponse(response, requestMethod);
}

function dataModuleStackLabel(
  match: string,
  fallbackDigest: string | undefined,
): string {
  const digestMarker = "sha256=";
  const markerIndex = apply(stringIndexOf, match, [digestMarker]) as number;
  const digestStart = markerIndex < 0 ? -1 : markerIndex + digestMarker.length;
  const digest = digestStart < 0
    ? "unknown"
    : apply(stringSlice, match, [digestStart, digestStart + 64]) as string;
  const safeDigest = matches(LOWERCASE_SHA256_PATTERN, digest)
    ? digest
    : fallbackDigest !== undefined &&
        matches(LOWERCASE_SHA256_PATTERN, fallbackDigest)
    ? fallbackDigest
    : "unknown";

  const location = apply(regexpExec, STACK_LOCATION_PATTERN, [
    match,
  ]) as RegExpExecArray | null;
  return location ? `vf-api:${safeDigest}:${location[1]}:${location[2]}` : `vf-api:${safeDigest}`;
}

/**
 * Remove encoded project source from data-module stack frames before any
 * boundary logger or response can observe it.
 */
export function sanitizeWorkerDataModuleStack(
  stack: string,
  fallbackDigest?: string,
): string {
  if (!matches(DATA_JAVASCRIPT_URL_PRESENCE_PATTERN, stack)) return stack;

  const replaced = apply(regexpReplace, DATA_JAVASCRIPT_URL_PATTERN, [
    stack,
    (match: string) => dataModuleStackLabel(match, fallbackDigest),
  ]) as string;
  const firstNewline = apply(stringIndexOf, replaced, ["\n"]) as number;
  const firstLine = firstNewline < 0
    ? replaced
    : apply(stringSlice, replaced, [0, firstNewline]) as string;
  const label = apply(regexpExec, SANITIZED_DATA_MODULE_LABEL_PATTERN, [
    replaced,
  ]) as RegExpExecArray | null;
  if (
    !label ||
    (apply(stringIndexOf, firstLine, [label[0]]) as number) >= 0
  ) {
    return firstLine;
  }
  return `${firstLine}\n    at ${label[0]}`;
}

function readNativeErrorStack(error: unknown): string | undefined {
  if (!isNativeErrorWithoutHooks(error)) return undefined;
  const descriptor = getOwnPropertyDescriptor(error, "stack");
  if (
    descriptor &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
  ) {
    return descriptor.value;
  }
  if (
    descriptor?.get === nativeErrorStackGetter &&
    nativeErrorStackGetter
  ) {
    const stack = apply(nativeErrorStackGetter, error, []);
    return typeof stack === "string" ? stack : undefined;
  }
  return undefined;
}

export function serializeError(
  error: unknown,
  dataModuleDigest?: string,
): SerializedError {
  const sourceWasError = isNativeErrorWithoutHooks(error);
  const sourceWasNativeTypeError = sourceWasError &&
    error !== null &&
    typeof error === "object" &&
    !isProxy(error) &&
    getPrototypeOf(error) === nativeTypeErrorPrototype;
  const detached = detachThrowableForBoundary(error);
  if (sourceWasError) {
    try {
      const stack = readNativeErrorStack(error);
      if (typeof stack === "string") {
        defineProperty(detached, "stack", {
          configurable: true,
          value: sanitizeWorkerDataModuleStack(stack, dataModuleDigest),
          writable: true,
        });
      }
    } catch {
      // The detached boundary snapshot remains safe when a stack is unreadable.
    }
  }
  const snapshot = snapshotErrorForBoundary(detached);
  const message = snapshot.slug === "unknown-error"
    ? snapshot.detail ?? snapshot.message
    : snapshot.message;
  const sanitizeDataDiagnostic = (value: string): string =>
    sanitizeWorkerDataModuleStack(value, dataModuleDigest);
  const sanitizeOptionalDataDiagnostic = (
    value: string | undefined,
  ): string | undefined => value === undefined ? undefined : sanitizeDataDiagnostic(value);

  return {
    message: sanitizeDataDiagnostic(sanitizeDiagnosticText(message)),
    name: sanitizeDataDiagnostic(
      sanitizeDiagnosticText(
        sourceWasNativeTypeError ? "TypeError" : detached.name,
      ),
    ),
    stack: sourceWasError && snapshot.stack !== undefined
      ? sanitizeWorkerDataModuleStack(snapshot.stack, dataModuleDigest)
      : undefined,
    problem: {
      slug: snapshot.slug,
      category: snapshot.category,
      status: snapshot.status,
      title: sanitizeDataDiagnostic(snapshot.title),
      suggestion: sanitizeOptionalDataDiagnostic(snapshot.suggestion),
      detail: sanitizeOptionalDataDiagnostic(snapshot.detail),
      cause: typeof snapshot.cause === "string"
        ? sanitizeDataDiagnostic(snapshot.cause)
        : undefined,
      instance: sanitizeOptionalDataDiagnostic(snapshot.instance),
    },
  };
}

// ---------------------------------------------------------------------------
// Module Cache
// ---------------------------------------------------------------------------

const moduleCache = new Map<string, Record<string, unknown>>();
const preparedModuleCache = new Map<
  string,
  Promise<Record<string, unknown>>
>();
const retainedPreparedModuleIdentities = new Set<string>();
const preparedModuleFailureCauses = new WeakMap<Error, { cause: unknown }>();
let retainedPreparedModuleSourceBytes = 0;
const WORKER_MODULE_CAPACITY_ERROR = new NativeError(
  "Worker prepared-module retention capacity exceeded",
);
const WORKER_SSR_OUTPUT_BYTE_LIMIT_ERROR = new NativeError(
  "Isolated SSR output exceeded its byte boundary",
);
const WORKER_SSR_OUTPUT_CHUNK_LIMIT_ERROR = new NativeError(
  "Isolated SSR output exceeded its chunk boundary",
);

function closeForSSRProtocolViolation(): void {
  try {
    closeWorkerProcess?.();
  } catch {
    // Closing the worker is the only safe recovery from a framework-wire fault.
  }
}

function waitForStreamCredit(
  execution: SSRExecutionContext,
  sequence: number,
): Promise<void> {
  if (apply(mapGet, streamCreditWaiters, [execution.token]) !== undefined) {
    throw new NativeError("Duplicate isolated SSR stream credit waiter");
  }
  return new NativePromise<void>((resolve) => {
    apply(mapSet, streamCreditWaiters, [
      execution.token,
      {
        id: execution.id,
        generation: execution.generation,
        token: execution.token,
        sequence,
        resolve,
      } satisfies StreamCreditWaiter,
    ]);
  });
}

function discardStreamCredit(token: string): void {
  apply(mapDelete, streamCreditWaiters, [token]);
}

function acceptWorkerStreamCredit(credit: WorkerStreamCredit): void {
  const waiter = apply(mapGet, streamCreditWaiters, [credit.token]) as
    | StreamCreditWaiter
    | undefined;
  if (
    !waiter ||
    credit.id !== waiter.id ||
    credit.generation !== waiter.generation ||
    credit.token !== waiter.token ||
    credit.sequence !== waiter.sequence
  ) {
    closeForSSRProtocolViolation();
    return;
  }
  apply(mapDelete, streamCreditWaiters, [credit.token]);
  waiter.resolve();
}
function wrapPreparedModuleFailure(
  cause: unknown,
  digest: string,
): Error {
  const diagnostic = sanitizeWorkerDataModuleStack(
    snapshotThrowableDiagnostic(cause),
    digest,
  );
  const error = new NativeError(
    diagnostic
      ? `Prepared API route module import failed: ${diagnostic}`
      : "Prepared API route module import failed",
  );
  const causeStack = readNativeErrorStack(cause);
  if (causeStack !== undefined) {
    defineProperty(error, "stack", {
      configurable: true,
      value: sanitizeWorkerDataModuleStack(causeStack, digest),
      writable: true,
    });
  }
  apply(weakMapSet, preparedModuleFailureCauses, [error, { cause }]);
  return error;
}

function preparedModuleFailureCause(error: unknown): {
  failed: boolean;
  cause: unknown;
} {
  if (!isNativeErrorWithoutHooks(error)) {
    return { failed: false, cause: undefined };
  }
  const record = apply(weakMapGet, preparedModuleFailureCauses, [error]) as
    | { cause: unknown }
    | undefined;
  return record === undefined
    ? { failed: false, cause: undefined }
    : { failed: true, cause: record.cause };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await digestBytes("SHA-256", bytes as BufferSource);
  return encodeSandboxBytesAsHex(new NativeUint8Array(digest));
}

export async function loadModule(modulePath: string): Promise<Record<string, unknown>> {
  const cached = apply(mapGet, moduleCache, [modulePath]) as
    | Record<string, unknown>
    | undefined;
  if (cached) return cached;

  const mod = await import(`file://${modulePath}`) as Record<string, unknown>;
  apply(mapSet, moduleCache, [modulePath, mod]);
  return mod;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedOwnKeys(record: Record<string, unknown>): string[] {
  const keys = objectKeys(record);
  apply(arraySort, keys, [compareStrings]);
  return keys;
}

function appendIdentityField(identity: string, value: string): string {
  return `${identity}${value.length}:${value};`;
}

function buildModuleSemanticIdentity(
  policy: SourceIntegrationPolicyManifest,
  env: Record<string, string> | undefined,
): string {
  let identity = "policy;";
  identity = appendIdentityField(identity, policy.mode);

  if (policy.mode === "allowlist") {
    const integrationNames = sortedOwnKeys(policy.integrations);
    for (let index = 0; index < integrationNames.length; index++) {
      const integrationName = integrationNames[index]!;
      identity = appendIdentityField(identity, integrationName);
      const allowedToolIds = policy.integrations[integrationName]!.allowedToolIds;
      if (allowedToolIds === null) {
        identity += "all;";
        continue;
      }
      const sortedToolIds = new NativeArray<string>(allowedToolIds.length);
      for (let toolIndex = 0; toolIndex < allowedToolIds.length; toolIndex++) {
        defineDataProperty(
          sortedToolIds,
          NativeString(toolIndex),
          allowedToolIds[toolIndex],
        );
      }
      apply(arraySort, sortedToolIds, [compareStrings]);
      identity += "tools;";
      for (let toolIndex = 0; toolIndex < sortedToolIds.length; toolIndex++) {
        identity = appendIdentityField(identity, sortedToolIds[toolIndex]!);
      }
    }
  }

  identity += "env;";
  if (env) {
    const envKeys = sortedOwnKeys(env);
    for (let index = 0; index < envKeys.length; index++) {
      const key = envKeys[index]!;
      identity = appendIdentityField(identity, key);
      identity = appendIdentityField(identity, env[key]!);
    }
  }
  return identity;
}

function reservePreparedModuleIdentity(
  cacheKey: string,
  sourceBytes: number,
): void {
  if (apply(setHas, retainedPreparedModuleIdentities, [cacheKey])) return;
  if (!setSizeGetter) throw WORKER_MODULE_CAPACITY_ERROR;

  const entryCount = apply(
    setSizeGetter,
    retainedPreparedModuleIdentities,
    [],
  ) as number;
  if (
    entryCount >= MAX_WORKER_RETAINED_MODULES ||
    sourceBytes >
      MAX_WORKER_RETAINED_MODULE_SOURCE_BYTES -
        retainedPreparedModuleSourceBytes
  ) {
    throw WORKER_MODULE_CAPACITY_ERROR;
  }

  apply(setAdd, retainedPreparedModuleIdentities, [cacheKey]);
  retainedPreparedModuleSourceBytes += sourceBytes;
}

function snapshotResolvedRouteMethods(
  methods: unknown,
  allowEmpty: boolean,
): string[] {
  const input = requireDenseArray(
    methods,
    "route methods",
    MAX_WORKER_ROUTE_METHOD_COUNT,
  );
  if (!allowEmpty && input.length === 0) {
    throw new NativeTypeError(
      "Prepared API route module has no callable route export",
    );
  }

  const output = new NativeArray<string>(input.length);
  for (let index = 0; index < input.length; index++) {
    const method = requireString(
      arrayElement(input, index, "route methods"),
      "route method",
      64,
      false,
    );
    if (!matches(CANONICAL_ROUTE_METHOD_PATTERN, method)) {
      return invalidWorkerRequest("route method");
    }
    defineDataProperty(output, NativeString(index), method);
  }
  return output;
}

function validatePreparedRouteModule(
  module: Record<string, unknown>,
): Record<string, unknown> {
  snapshotResolvedRouteMethods(
    resolveExecutableRouteMethods(
      module,
      undefined,
      { includeFrameworkOptions: false },
    ),
    false,
  );
  return module;
}

interface PreparedModuleLoadOptions {
  logicalModuleId: string;
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  projectEnv?: Record<string, string>;
}

/**
 * Rehash, content-address, import, and validate one host-prepared API module.
 *
 * The ESM identity includes logical route, source, and top-level semantic
 * context. No raw path, source, policy, or env value appears in the URL.
 */
export async function loadPreparedModule(
  value: PreparedWorkerModule,
  options: PreparedModuleLoadOptions,
): Promise<Record<string, unknown>> {
  const prepared = snapshotPreparedWorkerModule(value);
  const logicalModuleId = requireString(
    options.logicalModuleId,
    "modulePath",
    MAX_WORKER_PATH_CHARS,
    false,
  );
  const policy = snapshotSourceIntegrationPolicy(options.sourceIntegrationPolicy);
  const env = snapshotProjectEnv(options.projectEnv);
  const semanticIdentity = buildModuleSemanticIdentity(policy, env);
  const sourceBytes = encodeUtf8(prepared.source);
  const sourceByteLength = byteLengthOf(sourceBytes);

  const actualDigest = await sha256Hex(sourceBytes);
  if (actualDigest !== prepared.sha256) {
    throw new NativeTypeError("Prepared API route module digest mismatch");
  }

  const logicalModuleHash = await sha256Hex(encodeUtf8(logicalModuleId));
  const semanticContextHash = await sha256Hex(encodeUtf8(semanticIdentity));
  const cacheKey = `${logicalModuleHash}:${semanticContextHash}:${prepared.sha256}`;
  const cached = apply(mapGet, preparedModuleCache, [cacheKey]) as
    | Promise<Record<string, unknown>>
    | undefined;
  if (cached) return await cached;

  reservePreparedModuleIdentity(cacheKey, sourceByteLength);
  const encodedSource = encodeSandboxBytesAsBase64(sourceBytes);
  const moduleUrl = `data:text/javascript;base64,${encodedSource}#vf-route=${logicalModuleHash}` +
    `&vf-context=${semanticContextHash}&sha256=${prepared.sha256}`;
  const pending = (async () => {
    try {
      const module = await import(moduleUrl) as Record<string, unknown>;
      return validatePreparedRouteModule(module);
    } catch (error) {
      throw wrapPreparedModuleFailure(error, prepared.sha256);
    }
  })();
  apply(mapSet, preparedModuleCache, [cacheKey, pending]);
  return await pending;
}

/** @internal Read-only retention counters for deterministic capacity tests. */
export function getPreparedModuleRetentionStats(): {
  entries: number;
  sourceBytes: number;
} {
  const entries = setSizeGetter
    ? apply(setSizeGetter, retainedPreparedModuleIdentities, []) as number
    : 0;
  return { entries, sourceBytes: retainedPreparedModuleSourceBytes };
}

// ---------------------------------------------------------------------------
// Request-owned Project Env
// ---------------------------------------------------------------------------

function createRequestProjectEnv(
  env: Record<string, string> | undefined,
): Readonly<Record<string, string>> {
  const output = createNullPrototypeRecord<string>();
  if (env) {
    const entries = apply(objectEntries, Object, [env]) as [string, string][];
    for (let index = 0; index < entries.length; index++) {
      const [key, value] = entries[index]!;
      defineDataProperty(output, key, value);
    }
  }
  return freezeObject(output);
}

// ---------------------------------------------------------------------------
// Request Handlers
// ---------------------------------------------------------------------------

function runWithWorkerSourceIntegrationPolicy<T>(
  policy: SourceIntegrationPolicyManifest,
  fn: () => T,
): T {
  return runWithExactSourceIntegrationPolicy(policy, fn);
}

async function handleAppRoute(req: ExecuteAppRouteRequest): Promise<SerializedResponse> {
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    async () => {
      const env = createRequestProjectEnv(req.projectEnv);
      const mod = await loadPreparedModule(req.module, {
        logicalModuleId: req.modulePath,
        sourceIntegrationPolicy: req.sourceIntegrationPolicy,
        projectEnv: req.projectEnv,
      });

      const handlerFn = resolveRouteHandlerExport(mod, req.method) as
        | ((
          request: Request,
          context: {
            params: Record<string, string>;
            env: Readonly<Record<string, string>>;
            identity: ApplicationIdentity | null;
            applicationIdentity: ApplicationIdentity | null;
          },
        ) => Promise<unknown> | unknown)
        | undefined;

      if (!handlerFn) {
        return serializeResponse(
          createAppRouteMethodNotAllowed(mod),
          req.method,
        );
      }

      const pendingResponse = handlerFn(deserializeRequest(req.request), {
        params: req.params ?? {},
        env,
        identity: req.applicationIdentity,
        applicationIdentity: req.applicationIdentity,
      });
      const response = isTrustedRouteResponsePromise(pendingResponse)
        ? await pendingResponse
        : pendingResponse;
      return serializeResponse(response, req.method);
    },
  );
}

function deserializeDataContext(
  s: SerializedDataContext,
): {
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  request: Request;
  url: URL;
  identity: ApplicationIdentity | null;
  applicationIdentity: ApplicationIdentity | null;
} {
  const request = new NativeRequest(s.request.url, {
    method: s.request.method,
    headers: s.request.headers,
    body: s.request.body as BodyInit | null,
  });
  const applicationIdentity = s.applicationIdentity ?? null;
  return {
    params: s.params,
    query: new NativeURLSearchParams(s.query),
    request,
    url: new NativeURL(s.url),
    identity: applicationIdentity,
    applicationIdentity,
  };
}

/**
 * Run the project's `getServerData` and fold a thrown control result back into
 * a normal result.
 *
 * `throw notFound()` and `throw redirect(...)` must behave like the returned
 * form here as well as in-process. The normalisation has to happen inside the
 * worker: the brand is a symbol, `structuredClone` drops symbols, and the
 * worker error path would otherwise serialize the plain object with `String()`
 * and hand the host "[object Object]" as a 500.
 */
async function runServerData(
  getServerData: (ctx: unknown) => unknown | Promise<unknown>,
  context: unknown,
): Promise<SerializedDataResult> {
  try {
    return (await getServerData(context)) as SerializedDataResult;
  } catch (error) {
    if (isDataControlResult(error)) return toDataControlResult(error);
    throw error;
  }
}

async function handleFetchData(req: FetchDataRequest): Promise<SerializedDataResult> {
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    async () => {
      const mod = await loadModule(req.modulePath);
      const getServerData = mod.getServerData as
        | ((ctx: unknown) => unknown | Promise<unknown>)
        | undefined;

      if (typeof getServerData !== "function") {
        return { props: {} };
      }

      const context = deserializeDataContext(req.context);
      return snapshotDataResultForBoundary(
        await runServerData(getServerData, context),
      );
    },
  );
}

async function handlePagesRoute(req: ExecutePagesRouteRequest): Promise<SerializedResponse> {
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    async () => {
      const env = createRequestProjectEnv(req.projectEnv);
      const mod = await loadPreparedModule(req.module, {
        logicalModuleId: req.modulePath,
        sourceIntegrationPolicy: req.sourceIntegrationPolicy,
        projectEnv: req.projectEnv,
      });

      const handlerFn = resolveRouteHandlerExport(mod, req.method) as
        | ((ctx: unknown) => Promise<unknown> | unknown)
        | undefined;

      if (!handlerFn) {
        return serializeResponse(
          createPagesRouteMethodNotAllowed(mod),
          req.method,
        );
      }

      const { request, params, cookies } = deserializePagesRequest(req.context);
      const url = new NativeURL(request.url);

      // Build a minimal read-only fs adapter scoped to the project directory.
      // Every path is validated against the project root before it reaches a
      // Deno API so user route handlers cannot read arbitrary host files.
      const assertContained = makeProjectPathGuard(req.projectDir);
      const workerFs = {
        readTextFile: async (path: string) => denoReadTextFile(await assertContained(path)),
        readFile: async (path: string) => denoReadFile(await assertContained(path)),
        exists: async (path: string) => {
          try {
            await denoStat(await assertContained(path));
            return true;
          } catch (error) {
            if (isNativeNotFound(error)) return false;
            throw error;
          }
        },
        stat: async (path: string) => {
          const info = await denoStat(await assertContained(path));
          return {
            isFile: info.isFile,
            isDirectory: info.isDirectory,
            isSymlink: info.isSymlink,
            size: info.size,
            mtime: info.mtime,
          };
        },
        readDir: async function* (path: string) {
          const safePath = await assertContained(path);
          for await (const entry of denoReadDir(safePath)) {
            yield { name: entry.name, isFile: entry.isFile, isDirectory: entry.isDirectory };
          }
        },
      };

      // Build a minimal APIContext (subset of the full context)
      const ctx = {
        request,
        req: request,
        params,
        query: url.searchParams,
        cookies,
        headers: request.headers,
        url,
        // The same helpers the in-process context uses, so a handler behaves
        // the same whether or not isolation is enabled.
        json: createWorkerJsonResponse,
        body: createBodyReader(request),
        text: createWorkerTextResponse,
        fs: workerFs,
        env,
        identity: req.applicationIdentity,
        applicationIdentity: req.applicationIdentity,
      };

      const pendingResponse = handlerFn(ctx);
      const response = isTrustedRouteResponsePromise(pendingResponse)
        ? await pendingResponse
        : pendingResponse;
      return serializeResponse(response, req.method);
    },
  );
}

async function handleInspectApiRouteMethods(
  req: InspectApiRouteMethodsRequest,
): Promise<string[]> {
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    async () => {
      const mod = await loadPreparedModule(req.module, {
        logicalModuleId: req.modulePath,
        sourceIntegrationPolicy: req.sourceIntegrationPolicy,
        projectEnv: req.projectEnv,
      });
      return snapshotResolvedRouteMethods(
        resolveExecutableRouteMethods(mod, req.requestedMethod, {
          includeFrameworkOptions: req.includeFrameworkOptions,
        }),
        false,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// SSR Rendering Handler
// ---------------------------------------------------------------------------

/**
 * Handle SSR rendering in the isolated Worker.
 *
 * Imports the page + layout components from their temp file paths,
 * constructs an extension-owned element tree (layouts wrapping page), and
 * renders bounded HTML output. For streaming, sends chunks via postMessage.
 *
 * The Worker gets its own renderer instance; framework core never imports or
 * shares a renderer implementation across the host boundary.
 */
async function handleRenderSSR(
  req: RenderSSRRequest,
  execution: SSRExecutionContext,
): Promise<string | null> {
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    async () => await renderSSR(req, execution),
  );
}

interface FixedUint8View {
  readonly buffer: ArrayBuffer;
  readonly byteOffset: number;
  readonly byteLength: number;
}

function inspectFixedUint8View(value: unknown): FixedUint8View {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    getPrototypeOf(value) !== uint8ArrayPrototype ||
    !typedArrayBufferGetter ||
    !typedArrayByteLengthGetter ||
    !typedArrayByteOffsetGetter ||
    !arrayBufferByteLengthGetter
  ) {
    throw new NativeTypeError("SSR renderer emitted a non-native byte chunk");
  }

  const buffer = apply(typedArrayBufferGetter, value, []) as unknown;
  if (
    buffer === null ||
    typeof buffer !== "object" ||
    getPrototypeOf(buffer) !== arrayBufferPrototype
  ) {
    throw new NativeTypeError("SSR renderer emitted a shared byte chunk");
  }
  if (
    arrayBufferResizableGetter &&
    apply(arrayBufferResizableGetter, buffer, []) === true
  ) {
    throw new NativeTypeError("SSR renderer emitted a resizable byte chunk");
  }

  const byteOffset = apply(typedArrayByteOffsetGetter, value, []) as number;
  const byteLength = apply(typedArrayByteLengthGetter, value, []) as number;
  const bufferByteLength = apply(arrayBufferByteLengthGetter, buffer, []) as number;
  if (
    !numberIsSafeInteger(byteOffset) ||
    !numberIsSafeInteger(byteLength) ||
    byteOffset < 0 ||
    byteLength < 0 ||
    byteOffset > bufferByteLength ||
    byteLength > bufferByteLength - byteOffset
  ) {
    throw new NativeTypeError("SSR renderer emitted an invalid byte view");
  }
  return {
    buffer: buffer as ArrayBuffer,
    byteOffset,
    byteLength,
  };
}

function copyTightSSRFrame(
  source: FixedUint8View,
  relativeOffset: number,
  byteLength: number,
): Uint8Array {
  if (
    byteLength <= 0 ||
    byteLength > MAX_WORKER_SSR_CHUNK_BYTES ||
    relativeOffset < 0 ||
    relativeOffset > source.byteLength ||
    byteLength > source.byteLength - relativeOffset
  ) {
    throw new NativeTypeError("Invalid isolated SSR frame slice");
  }
  const sourceSlice = new NativeUint8Array(
    source.buffer,
    source.byteOffset + relativeOffset,
    byteLength,
  );
  const frame = new NativeUint8Array(byteLength);
  apply(setBytes, frame, [sourceSlice]);

  const frameBuffer = typedArrayBufferGetter
    ? apply(typedArrayBufferGetter, frame, []) as ArrayBuffer
    : undefined;
  const frameOffset = typedArrayByteOffsetGetter
    ? apply(typedArrayByteOffsetGetter, frame, []) as number
    : -1;
  const frameBufferBytes = frameBuffer && arrayBufferByteLengthGetter
    ? apply(arrayBufferByteLengthGetter, frameBuffer, []) as number
    : -1;
  if (
    !frameBuffer ||
    getPrototypeOf(frameBuffer) !== arrayBufferPrototype ||
    frameOffset !== 0 ||
    frameBufferBytes !== byteLength ||
    (arrayBufferResizableGetter &&
      apply(arrayBufferResizableGetter, frameBuffer, []) === true)
  ) {
    throw new NativeError("Unable to allocate a fixed isolated SSR frame");
  }
  return frame;
}

async function sendStreamFrame(
  execution: SSRExecutionContext,
  frame: Uint8Array,
): Promise<void> {
  const sequence = execution.sequence;
  const nextSequence = sequence + 1;
  const credit = waitForStreamCredit(execution, nextSequence);
  try {
    const buffer = apply(typedArrayBufferGetter!, frame, []) as ArrayBuffer;
    const message: WorkerStreamFrame = {
      type: "stream-frame",
      id: execution.id,
      generation: execution.generation,
      token: execution.token,
      sequence,
      chunk: frame,
    };
    sendControlMessage(message, [buffer]);
    execution.sequence = nextSequence;
  } catch (error) {
    discardStreamCredit(execution.token);
    throw error;
  }
  await credit;
}

/**
 * Bound framework-owned SSR retention after the renderer yields each source chunk.
 *
 * This worker shares a process with the renderer and project code. Either may
 * therefore allocate a large value before the framework can observe,
 * split, account, cancel, or release it. A hard pre-allocation memory boundary
 * requires process/container isolation rather than a same-process Worker.
 */
async function consumeSSRByteStream(
  stream: ReadableStream<Uint8Array>,
  onFrame: (frame: Uint8Array) => Promise<void> | void,
): Promise<number> {
  const reader = apply(
    readableStreamGetReader,
    stream,
    [],
  ) as ReadableStreamDefaultReader<Uint8Array>;
  let completed = false;
  let outputBytes = 0;
  let outputFrames = 0;
  let sourceChunks = 0;

  try {
    while (true) {
      const { done, value } = await apply(
        readableStreamReaderRead,
        reader,
        [],
      ) as ReadableStreamReadResult<Uint8Array>;
      if (done) {
        completed = true;
        return outputBytes;
      }

      sourceChunks += 1;
      if (sourceChunks > MAX_WORKER_SSR_OUTPUT_CHUNKS) {
        throw WORKER_SSR_OUTPUT_CHUNK_LIMIT_ERROR;
      }
      const source = inspectFixedUint8View(value);
      if (source.byteLength > MAX_WORKER_SSR_OUTPUT_BYTES - outputBytes) {
        throw WORKER_SSR_OUTPUT_BYTE_LIMIT_ERROR;
      }
      outputBytes += source.byteLength;

      let offset = 0;
      while (offset < source.byteLength) {
        outputFrames += 1;
        if (outputFrames > MAX_WORKER_SSR_OUTPUT_CHUNKS) {
          throw WORKER_SSR_OUTPUT_CHUNK_LIMIT_ERROR;
        }
        const frameBytes = Math.min(
          MAX_WORKER_SSR_CHUNK_BYTES,
          source.byteLength - offset,
        );
        const frame = copyTightSSRFrame(source, offset, frameBytes);
        await onFrame(frame);
        offset += frameBytes;
      }
    }
  } finally {
    if (!completed) {
      try {
        await (apply(
          readableStreamReaderCancel,
          reader,
          ["Isolated SSR rendering stopped"],
        ) as Promise<void>);
      } catch {
        // The worker request failure remains authoritative.
      }
    }
    try {
      apply(readableStreamReaderReleaseLock, reader, []);
    } catch {
      // The worker request failure remains authoritative.
    }
  }
}

async function renderSSR(
  req: RenderSSRRequest,
  execution: SSRExecutionContext,
): Promise<string | null> {
  assertIsolatedSsrDependencySnapshotSupported(req);
  const renderer = await getIsolatedSsrRenderer();
  const createElement = renderer.createElement;
  const renderToReadableStream = renderer.renderToReadableStream;

  // Import the page component
  const pageMod = await loadModule(req.pageModulePath);
  const PageComponent = pageMod.default ?? pageMod;

  // Import layout components (innermost → outermost order)
  const layoutComponents = new NativeArray<unknown>(req.layoutModulePaths.length);
  for (let index = 0; index < req.layoutModulePaths.length; index++) {
    const layoutPath = req.layoutModulePaths[index]!;
    const layoutMod = await loadModule(layoutPath);
    defineDataProperty(
      layoutComponents,
      NativeString(index),
      layoutMod.default ?? layoutMod,
    );
  }

  // Build element tree: page is innermost, layouts wrap outward
  let element: unknown = createElement(PageComponent, req.pageProps);

  for (let i = 0; i < layoutComponents.length; i++) {
    const Layout = layoutComponents[i];
    const layoutProps = req.layoutProps[i] ?? {};
    element = createElement(Layout, layoutProps, element);
  }

  const stream = await renderToReadableStream(element);
  if (execution.delivery === "stream") {
    await consumeSSRByteStream(
      stream,
      async (frame) => await sendStreamFrame(execution, frame),
    );
    return null;
  }

  const frames = new NativeArray<Uint8Array>();
  const outputBytes = await consumeSSRByteStream(stream, (frame) => {
    apply(arrayPush, frames, [frame]);
  });
  const collected = new NativeUint8Array(outputBytes);
  let offset = 0;
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]!;
    apply(setBytes, collected, [frame, offset]);
    offset += byteLengthOf(frame);
  }
  return apply(decodeText, textDecoder, [collected]) as string;
}

// ---------------------------------------------------------------------------
// Message Handler
// ---------------------------------------------------------------------------

function claimQueuedSSRExecution(
  request: RenderSSRRequest,
): SSRExecutionContext | null {
  const execution = pendingSSRExecutionOpen;
  if (
    !execution ||
    execution.id !== request.id ||
    execution.delivery !== request.delivery ||
    execution.generation !== workerWireGeneration
  ) {
    closeForSSRProtocolViolation();
    return null;
  }
  pendingSSRExecutionOpen = null;
  return execution;
}

async function processSSRWorkerRequest(
  request: RenderSSRRequest,
  execution: SSRExecutionContext,
): Promise<void> {
  if (apply(mapGet, activeSSRExecutions, [request.id]) !== undefined) {
    closeForSSRProtocolViolation();
    return;
  }
  apply(mapSet, activeSSRExecutions, [request.id, execution]);

  try {
    if (!egressInitialized) {
      throw new NativeError("Worker egress guard is not initialized");
    }
    const html = await handleRenderSSR(request, execution);
    if (execution.delivery === "stream") {
      const end: WorkerStreamEnd = {
        type: "stream-end",
        id: execution.id,
        generation: execution.generation,
        token: execution.token,
        sequence: execution.sequence,
      };
      sendControlMessage(end);
    } else {
      if (html === null || execution.sequence !== 0) {
        throw new NativeError("Invalid isolated SSR string rendering state");
      }
      const result: WorkerSSRWireResult = {
        type: "ssr-wire-result",
        id: execution.id,
        generation: execution.generation,
        token: execution.token,
        sequence: 0,
        html,
      };
      sendControlMessage(result);
    }
  } catch (error) {
    if (
      error === WORKER_SSR_OUTPUT_BYTE_LIMIT_ERROR ||
      error === WORKER_SSR_OUTPUT_CHUNK_LIMIT_ERROR
    ) {
      const outputLimit: WorkerSSROutputLimit = {
        type: "ssr-output-limit",
        id: execution.id,
        generation: execution.generation,
        token: execution.token,
        sequence: execution.sequence,
        limit: error === WORKER_SSR_OUTPUT_BYTE_LIMIT_ERROR ? "bytes" : "chunks",
      };
      sendControlMessage(outputLimit);
    } else {
      const failure: WorkerSSRWireError = {
        type: "ssr-wire-error",
        id: execution.id,
        generation: execution.generation,
        token: execution.token,
        sequence: execution.sequence,
        error: serializeError(error),
      };
      sendControlMessage(failure);
    }
  } finally {
    discardStreamCredit(execution.token);
    const active = apply(mapGet, activeSSRExecutions, [
      execution.id,
    ]) as SSRExecutionContext | undefined;
    if (active === execution) {
      apply(mapDelete, activeSSRExecutions, [execution.id]);
    }
  }
}

async function processWorkerRequest(
  request: WorkerRequest,
  ssrExecution?: SSRExecutionContext,
): Promise<void> {
  if (request.type === "render-ssr") {
    if (!ssrExecution) {
      closeForSSRProtocolViolation();
      return;
    }
    await processSSRWorkerRequest(request, ssrExecution);
    return;
  }

  try {
    if (!egressInitialized) {
      throw new NativeError("Worker egress guard is not initialized");
    }

    // Data fetcher returns a different response shape than HTTP handlers
    if (request.type === "fetch-data") {
      const dataResult = await handleFetchData(request);
      const response: WorkerDataResultResponse = {
        type: "data-result",
        id: request.id,
        result: dataResult,
      };
      sendControlMessage(response);
      return;
    }

    if (request.type === "inspect-api-route-methods") {
      const response: WorkerRouteMethodsResponse = {
        type: "api-route-methods",
        id: request.id,
        methods: await handleInspectApiRouteMethods(request),
      };
      sendControlMessage(response);
      return;
    }

    let serializedResponse: SerializedResponse;

    switch (request.type) {
      case "execute-app-route":
        serializedResponse = await handleAppRoute(request);
        break;
      case "execute-pages-route":
        serializedResponse = await handlePagesRoute(request);
        break;
      default:
        throw new NativeError("Unknown worker request type");
    }

    const result: WorkerResultResponse = {
      type: "result",
      id: request.id,
      response: serializedResponse,
    };
    sendControlMessage(result);
  } catch (error) {
    if (error === WORKER_MODULE_CAPACITY_ERROR) {
      const capacityResponse: WorkerPreparedModuleCapacityResponse = {
        type: "prepared-module-capacity",
        id: request.id,
      };
      sendControlMessage(capacityResponse);
      return;
    }

    const dataModuleDigest = request.type === "execute-app-route" ||
        request.type === "execute-pages-route" ||
        request.type === "inspect-api-route-methods"
      ? request.module.sha256
      : undefined;
    const preparedFailure = preparedModuleFailureCause(error);
    const errorResponse: WorkerErrorResponse = {
      type: "error",
      id: request.id,
      error: serializeError(
        preparedFailure.failed ? preparedFailure.cause : error,
        dataModuleDigest,
      ),
    };
    sendControlMessage(errorResponse);
    if (preparedFailure.failed) {
      closeWorkerProcess?.();
    }
  }
}

let requestQueue: Promise<void> = Promise.resolve();

function snapshotControlMessageId(value: unknown): string {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    isArray(value)
  ) {
    return "";
  }
  const descriptor = getOwnPropertyDescriptor(value, "id");
  return descriptor && "value" in descriptor &&
      typeof descriptor.value === "string" &&
      descriptor.value.length > 0 &&
      descriptor.value.length <= MAX_WORKER_REQUEST_ID_CHARS
    ? descriptor.value
    : "";
}

function enqueueWorkerRequest(
  request: WorkerRequest,
  ssrExecution?: SSRExecutionContext,
): void {
  // Project code may mutate Promise.prototype after its first import. Invoke
  // the captured intrinsic directly so the serialized env overlay queue
  // remains framework-owned.
  requestQueue = apply(promiseThen, requestQueue, [
    () => processWorkerRequest(request, ssrExecution),
    () => processWorkerRequest(request, ssrExecution),
  ]) as Promise<void>;
}

function snapshotSSRExecutionOpen(message: unknown): WorkerSSRExecutionOpen {
  const cloned = cloneStructuredValue(message);
  const open = requireRecordShape(
    cloned,
    ["type", "id", "generation", "token", "delivery"],
    [],
    "SSR execution open",
  );
  if (readDataProperty(open, "type") !== "ssr-execution-open") {
    return invalidWorkerRequest("type");
  }
  const delivery = readDataProperty(open, "delivery");
  if (delivery !== "string" && delivery !== "stream") {
    return invalidWorkerRequest("delivery");
  }
  return {
    type: "ssr-execution-open",
    id: requireString(
      readDataProperty(open, "id"),
      "id",
      MAX_WORKER_REQUEST_ID_CHARS,
      false,
    ),
    generation: requireString(
      readDataProperty(open, "generation"),
      "generation",
      MAX_SSR_WIRE_TOKEN_CHARS,
      false,
    ),
    token: requireString(
      readDataProperty(open, "token"),
      "token",
      MAX_SSR_WIRE_TOKEN_CHARS,
      false,
    ),
    delivery,
  };
}

function openSSRExecution(message: unknown): void {
  const open = snapshotSSRExecutionOpen(message);
  if (
    pendingSSRExecutionOpen !== null ||
    (workerWireGeneration !== null &&
      workerWireGeneration !== open.generation) ||
    apply(mapGet, activeSSRExecutions, [open.id]) !== undefined
  ) {
    closeForSSRProtocolViolation();
    return;
  }
  workerWireGeneration ??= open.generation;
  pendingSSRExecutionOpen = {
    id: open.id,
    generation: open.generation,
    token: open.token,
    delivery: open.delivery,
    sequence: 0,
  };
}

function snapshotStreamCredit(message: unknown): WorkerStreamCredit {
  const cloned = cloneStructuredValue(message);
  const credit = requireRecordShape(
    cloned,
    ["type", "id", "generation", "token", "sequence"],
    [],
    "stream credit",
  );
  if (readDataProperty(credit, "type") !== "stream-credit") {
    return invalidWorkerRequest("type");
  }
  const sequence = readDataProperty(credit, "sequence");
  if (
    typeof sequence !== "number" ||
    !numberIsSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_WORKER_SSR_OUTPUT_CHUNKS
  ) {
    return invalidWorkerRequest("sequence");
  }
  return {
    type: "stream-credit",
    id: requireString(
      readDataProperty(credit, "id"),
      "id",
      MAX_WORKER_REQUEST_ID_CHARS,
      false,
    ),
    generation: requireString(
      readDataProperty(credit, "generation"),
      "generation",
      MAX_SSR_WIRE_TOKEN_CHARS,
      false,
    ),
    token: requireString(
      readDataProperty(credit, "token"),
      "token",
      MAX_SSR_WIRE_TOKEN_CHARS,
      false,
    ),
    sequence,
  };
}

function sendInvalidSSRRequestFailure(
  message: unknown,
  error: unknown,
): void {
  const id = snapshotControlMessageId(message);
  const execution = pendingSSRExecutionOpen;
  if (!execution || execution.id !== id) {
    closeForSSRProtocolViolation();
    return;
  }
  pendingSSRExecutionOpen = null;
  sendControlMessage(
    {
      type: "ssr-wire-error",
      id,
      generation: execution.generation,
      token: execution.token,
      sequence: 0,
      error: serializeError(error),
    } satisfies WorkerSSRWireError,
  );
}

function handleControlPortMessage(event: MessageEvent<unknown>): void {
  const port = workerControlPort;
  if (!port || !isTrustedMessageEventFrom(event, port)) return;

  const message = readMessageEventData(event);
  let messageType: unknown;
  if (
    message !== null &&
    typeof message === "object" &&
    !isProxy(message) &&
    !isArray(message)
  ) {
    const descriptor = getOwnPropertyDescriptor(message, "type");
    messageType = descriptor && "value" in descriptor ? descriptor.value : undefined;
  }

  // The host posts an SSR open and its request synchronously on one ordered
  // channel. Pair them at admission so queued valid work does not consume a
  // separate hard-coded "pending open" capacity.
  if (
    pendingSSRExecutionOpen !== null &&
    messageType !== "render-ssr"
  ) {
    closeForSSRProtocolViolation();
    return;
  }

  if (messageType === "ping") {
    try {
      const cloned = cloneStructuredValue(message);
      const ping = requireRecordShape(cloned, ["type", "id"], [], "ping");
      const id = requireString(
        readDataProperty(ping, "id"),
        "id",
        MAX_WORKER_REQUEST_ID_CHARS,
        false,
      );
      sendControlMessage({ type: "pong", id });
    } catch (error) {
      sendControlMessage(
        {
          type: "error",
          id: snapshotControlMessageId(message),
          error: serializeError(error),
        } satisfies WorkerErrorResponse,
      );
    }
    return;
  }

  if (messageType === "ssr-execution-open") {
    try {
      openSSRExecution(message);
    } catch {
      closeForSSRProtocolViolation();
    }
    return;
  }

  if (messageType === "stream-credit") {
    try {
      acceptWorkerStreamCredit(snapshotStreamCredit(message));
    } catch {
      closeForSSRProtocolViolation();
    }
    return;
  }

  try {
    const request = snapshotWorkerRequest(message);
    if (request.type === "render-ssr") {
      const execution = claimQueuedSSRExecution(request);
      if (!execution) return;
      enqueueWorkerRequest(request, execution);
    } else {
      if (pendingSSRExecutionOpen !== null) {
        closeForSSRProtocolViolation();
        return;
      }
      enqueueWorkerRequest(request);
    }
  } catch (error) {
    if (messageType === "render-ssr") {
      sendInvalidSSRRequestFailure(message, error);
      return;
    }
    sendControlMessage(
      {
        type: "error",
        id: snapshotControlMessageId(message),
        error: serializeError(error),
      } satisfies WorkerErrorResponse,
    );
  }
}

function snapshotWorkerEgressSocksProxy(
  value: unknown,
): WorkerEgressSocksProxyConfig {
  const record = requireRecordShape(
    value,
    ["hostname", "port", "username", "password"],
    [],
    "bootstrap options socksProxy",
  );
  const port = readDataProperty(record, "port");
  if (
    typeof port !== "number" ||
    !numberIsSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return invalidWorkerRequest("bootstrap options socksProxy");
  }
  return {
    hostname: requireString(
      readDataProperty(record, "hostname"),
      "bootstrap options socksProxy hostname",
      MAX_WORKER_URL_CHARS,
      false,
    ),
    port,
    username: requireString(
      readDataProperty(record, "username"),
      "bootstrap options socksProxy username",
      MAX_WORKER_VALUE_CHARS,
      false,
    ),
    password: requireString(
      readDataProperty(record, "password"),
      "bootstrap options socksProxy password",
      MAX_WORKER_VALUE_CHARS,
      false,
    ),
  };
}

function snapshotWorkerEgressHttpBroker(
  value: unknown,
): WorkerEgressHttpBrokerConfig {
  const record = requireRecordShape(
    value,
    ["url", "token"],
    [],
    "bootstrap options httpBroker",
  );
  return {
    url: requireString(
      readDataProperty(record, "url"),
      "bootstrap options httpBroker url",
      MAX_WORKER_URL_CHARS,
      false,
    ),
    token: requireString(
      readDataProperty(record, "token"),
      "bootstrap options httpBroker token",
      MAX_WORKER_VALUE_CHARS,
      false,
    ),
  };
}

function snapshotWorkerEgressBootstrapOptions(
  value: unknown,
): InstalledWorkerEgressGuardOptions {
  const cloned = cloneStructuredValue(value);
  const record = requireRecordShape(
    cloned,
    ["allowInternalEgress"],
    ["socksProxy", "httpBroker"],
    "bootstrap options",
  );
  const allowInternalEgress = readDataProperty(
    record,
    "allowInternalEgress",
  );
  if (typeof allowInternalEgress !== "boolean") {
    return invalidWorkerRequest("bootstrap options allowInternalEgress");
  }

  const socksProxy = readOptionalDataProperty(record, "socksProxy");
  const httpBroker = readOptionalDataProperty(record, "httpBroker");
  return {
    allowInternalEgress,
    ...(socksProxy.present && socksProxy.value !== undefined
      ? { socksProxy: snapshotWorkerEgressSocksProxy(socksProxy.value) }
      : {}),
    ...(httpBroker.present && httpBroker.value !== undefined
      ? { httpBroker: snapshotWorkerEgressHttpBroker(httpBroker.value) }
      : {}),
  };
}

function handleWorkerBootstrapMessage(
  event: MessageEvent<
    InitializeEgressMessage
  >,
): void {
  if (
    egressInitialized ||
    !isTrustedMessageEventFrom(event, self)
  ) {
    return;
  }

  const message = readMessageEventData(event);
  const bootstrap = requireRecordShape(
    message,
    ["type", "options", "controlPort"],
    ["rendererModuleUrl"],
    "bootstrap",
  );
  if (readDataProperty(bootstrap, "type") !== "initialize-egress") return;

  const port = readDataProperty(bootstrap, "controlPort");
  if (!(port instanceof NativeMessagePort)) {
    throw new NativeTypeError("Invalid worker control port");
  }
  const rendererModuleUrlProperty = readOptionalDataProperty(
    bootstrap,
    "rendererModuleUrl",
  );
  isolatedSsrRendererModuleUrl = rendererModuleUrlProperty.present
    ? validateIsolatedSsrRendererModuleUrl(rendererModuleUrlProperty.value)
    : null;

  workerControlPort = port;
  postControlPortMessage = (
    payload: unknown,
    transfer?: readonly Transferable[],
  ): void => {
    apply(
      messagePortPostMessage,
      port,
      transfer === undefined ? [payload] : [payload, transfer],
    );
  };
  installWorkerExitNotifier();
  const options = snapshotWorkerEgressBootstrapOptions(
    readDataProperty(bootstrap, "options"),
  );
  apply(eventTargetAddEventListener, port, [
    "message",
    handleControlPortMessage as EventListener,
  ]);
  apply(messagePortStart, port, []);
  apply(eventTargetRemoveEventListener, self, [
    "message",
    handleWorkerBootstrapMessage as EventListener,
  ]);

  installWorkerEgressGuard(options);
  egressInitialized = true;
}

apply(eventTargetAddEventListener, self, [
  "message",
  handleWorkerBootstrapMessage as EventListener,
]);
