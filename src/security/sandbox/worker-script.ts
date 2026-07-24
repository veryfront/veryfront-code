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
  WorkerSSRResultResponse,
  WorkerStreamChunk,
  WorkerStreamEnd,
} from "./worker-types.ts";
import {
  MAX_WORKER_BODY_BYTES,
  MAX_WORKER_MODULE_SOURCE_BYTES,
  MAX_WORKER_RETAINED_MODULE_SOURCE_BYTES,
  MAX_WORKER_RETAINED_MODULES,
} from "./worker-types.ts";
import { installWorkerEgressGuard, type WorkerEgressGuardOptions } from "./worker-egress-guard.ts";
import { isAbsolute, relative, resolve as resolvePath, sep as PATH_SEP } from "node:path";
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
import {
  isTrustedRouteResponsePromise,
  serializeRouteResponse,
} from "#veryfront/routing/api/response-normalization.ts";

type InitializeEgressMessage = {
  type: "initialize-egress";
  options: WorkerEgressGuardOptions;
  controlPort: MessagePort;
};

const apply = Reflect.apply;
const cloneStructuredValue = globalThis.structuredClone.bind(globalThis);
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const eventTargetAddEventListener = EventTarget.prototype.addEventListener;
const eventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;
const eventCurrentTargetGetter = getOwnPropertyDescriptor(Event.prototype, "currentTarget")?.get;
const eventIsTrustedGetter = getOwnPropertyDescriptor(Event.prototype, "isTrusted")?.get;
const messageEventDataGetter = getOwnPropertyDescriptor(MessageEvent.prototype, "data")?.get;
const getPrototypeOf = Object.getPrototypeOf;
const objectEntries = Object.entries;
const objectKeys = Object.keys;
const ownKeys = Reflect.ownKeys;
const isArray = Array.isArray;
const isProxy = nodeUtilTypes.isProxy;
const NativeArray = Array;
const NativeError = Error;
const NativeMessagePort = MessagePort;
const NativeNotFound = Deno.errors.NotFound;
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
const typedArrayByteLengthGetter = typedArrayPrototype
  ? getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get
  : undefined;
const textEncoder = new TextEncoder();
const encodeText = TextEncoder.prototype.encode;
const bytesToBase64 = NativeUint8Array.prototype.toBase64;
const bytesToHex = NativeUint8Array.prototype.toHex;
const setBytes = NativeUint8Array.prototype.set;
const digestBytes = crypto.subtle.digest.bind(crypto.subtle);
const messagePortPostMessage = MessagePort.prototype.postMessage;
const messagePortStart = MessagePort.prototype.start;
const promiseThen = Promise.prototype.then;
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
const denoEnvGet = Deno.env.get.bind(Deno.env);
const denoEnvSet = Deno.env.set.bind(Deno.env);
const denoEnvDelete = Deno.env.delete.bind(Deno.env);
const denoReadDir = Deno.readDir.bind(Deno);
const denoReadFile = Deno.readFile.bind(Deno);
const denoReadTextFile = Deno.readTextFile.bind(Deno);
const denoRealPath = Deno.realPath.bind(Deno);
const denoStat = Deno.stat.bind(Deno);
const LOWERCASE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CANONICAL_POLICY_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const CANONICAL_ROUTE_METHOD_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Z]{1,64}$/;
const PROJECT_ENV_KEY_PATTERN = /^[^=\0]+$/;
const PROJECT_ENV_VALUE_PATTERN = /^[^\0]*$/;
const DATA_JAVASCRIPT_URL_PATTERN =
  /data:(?:text|application)\/javascript(?:;[a-zA-Z0-9=+._-]+)*,[^ \t\r\n)]*/g;
const DATA_JAVASCRIPT_URL_PRESENCE_PATTERN =
  /data:(?:text|application)\/javascript(?:;[a-zA-Z0-9=+._-]+)*,/;
const STACK_LOCATION_PATTERN = /:([0-9]+):([0-9]+)$/;
const SANITIZED_DATA_MODULE_LABEL_PATTERN = /vf-api:(?:[0-9a-f]{64}|unknown)(?::[0-9]+:[0-9]+)?/;
const MAX_WORKER_REQUEST_ID_CHARS = 256;
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
let postControlPortMessage: ((message: unknown) => void) | null = null;
let closeWorkerProcess: (() => void) | null = null;

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

function sendControlMessage(message: unknown): void {
  const postMessage = postControlPortMessage;
  if (!postMessage) {
    throw new NativeError("Worker control channel is not initialized");
  }
  postMessage(message);
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
  if (exitNotifierInstalled || typeof globalThis.close !== "function") return;

  const notifyExit = () => sendControlMessage({ type: "worker-exit" });
  const closeWorker = globalThis.close.bind(globalThis);
  const guardedClose = () => {
    try {
      notifyExit();
    } finally {
      closeWorker();
    }
  };
  closeWorkerProcess = guardedClose;
  globalThis.close = guardedClose;
  if (typeof Deno.exit === "function") {
    const exitWorker = Deno.exit.bind(Deno);
    Deno.exit = ((code?: number): never => {
      try {
        notifyExit();
      } catch {
        // Exit even if the notification channel is already closed.
      }
      return exitWorker(code);
    }) as typeof Deno.exit;
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

    // Canonicalize to defeat symlinks that escape the project. realPath fails
    // for a not-yet-existing target (e.g. a fresh path); the lexical check
    // above already covers that case, so fall back to the resolved path.
    realRootPromise ??= (async () => {
      try {
        return await denoRealPath(root);
      } catch {
        throw new NativeError("Unable to canonicalize project root");
      }
    })();
    const realRoot = await realRootPromise;
    const realResolved = await realPathIfExisting(resolved);
    if (realResolved !== null && !isContained(realRoot, realResolved)) {
      throw new NativeError(`Path escapes project directory: ${path}`);
    }

    return realResolved ?? resolved;
  };
}

// Load React lazily for SSR requests. API-only workers and health checks should
// start without resolving React, and the runtime caches dynamic imports after
// the first SSR request.
let _React: typeof import("react") | null = null;
let _ReactDOMServer: typeof import("react-dom/server") | null = null;
let _reactReady: Promise<void> | null = null;

function ensureReactReady(): Promise<void> {
  _reactReady ??= (async () => {
    try {
      _React = await import("react");
      _ReactDOMServer = await import("react-dom/server");
    } catch {
      // React may not be available in all worker contexts (e.g., API-only workers).
      // SSR handler will throw a clear error if React is needed but not loaded.
    }
  })();
  return _reactReady;
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
  ) as Record<string, string>;
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
    [],
    "context",
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
  if (typeof value !== "object" || value === null) {
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

function snapshotOptionalString(
  record: DataRecord,
  key: string,
  maxChars: number,
): string | undefined {
  const field = readOptionalDataProperty(record, key);
  if (!field.present || field.value === undefined) return undefined;
  return requireString(field.value, key, maxChars);
}

/**
 * Synchronously detach and validate one control-port request before it can be
 * observed or mutated by any later project task.
 *
 * @internal Exported for deterministic boundary regression tests.
 */
export function snapshotWorkerRequest(value: unknown): WorkerRequest {
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
        true,
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
      ["requestedMethod", "projectEnv"],
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
      [],
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
      [],
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
const WORKER_ENV_CLEANUP_ERROR = new NativeError(
  "Project environment cleanup failed",
);

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

export async function loadModule(modulePath: string): Promise<Record<string, unknown>> {
  const cached = apply(mapGet, moduleCache, [modulePath]) as
    | Record<string, unknown>
    | undefined;
  if (cached) return cached;

  const mod = await import(`file://${modulePath}`) as Record<string, unknown>;
  apply(mapSet, moduleCache, [modulePath, mod]);
  return mod;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await digestBytes("SHA-256", bytes as BufferSource);
  return apply(bytesToHex, new NativeUint8Array(digest), []) as string;
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
  sourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
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
  const policy = options.sourceIntegrationPolicy === undefined
    ? ({ schemaVersion: 1, mode: "unrestricted" } as const)
    : snapshotSourceIntegrationPolicy(options.sourceIntegrationPolicy);
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
  const encodedSource = apply(bytesToBase64, sourceBytes, []) as string;
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
// Project Env Overlay
// ---------------------------------------------------------------------------

async function withProjectEnv<T>(
  env: Record<string, string> | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!env) return await operation();

  const entries = apply(objectEntries, Object, [env]) as [string, string][];
  let operationFailed = false;
  let operationError: unknown;
  let result: T | undefined;
  try {
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      denoEnvSet(entry[0], entry[1]);
    }
    result = await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  let cleanupFailed = false;
  for (let index = 0; index < entries.length; index++) {
    const key = entries[index]![0];
    try {
      denoEnvDelete(key);
      if (denoEnvGet(key) !== undefined) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) throw WORKER_ENV_CLEANUP_ERROR;
  if (operationFailed) throw operationError;
  return result as T;
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
    () =>
      withProjectEnv(req.projectEnv, async () => {
        const mod = await loadPreparedModule(req.module, {
          logicalModuleId: req.modulePath,
          sourceIntegrationPolicy: req.sourceIntegrationPolicy,
          projectEnv: req.projectEnv,
        });

        const handlerFn = resolveRouteHandlerExport(mod, req.method) as
          | ((
            request: Request,
            context: { params: Record<string, string | string[]> },
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
        });
        const response = isTrustedRouteResponsePromise(pendingResponse)
          ? await pendingResponse
          : pendingResponse;
        return serializeResponse(response, req.method);
      }),
  );
}

function deserializeDataContext(
  s: SerializedDataContext,
): {
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  request: Request;
  url: URL;
} {
  const request = new NativeRequest(s.request.url, {
    method: s.request.method,
    headers: s.request.headers,
    body: s.request.body as BodyInit | null,
  });
  return {
    params: s.params,
    query: new NativeURLSearchParams(s.query),
    request,
    url: new NativeURL(s.url),
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
      const result = await runServerData(getServerData, context);

      // Normalize the result shape
      if (result.redirect) return { redirect: result.redirect };
      if (result.notFound) return { notFound: true };
      return { props: result.props ?? {}, revalidate: result.revalidate };
    },
  );
}

async function handlePagesRoute(req: ExecutePagesRouteRequest): Promise<SerializedResponse> {
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    () =>
      withProjectEnv(req.projectEnv, async () => {
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
        };

        const pendingResponse = handlerFn(ctx);
        const response = isTrustedRouteResponsePromise(pendingResponse)
          ? await pendingResponse
          : pendingResponse;
        return serializeResponse(response, req.method);
      }),
  );
}

async function handleInspectApiRouteMethods(
  req: InspectApiRouteMethodsRequest,
): Promise<string[]> {
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    () =>
      withProjectEnv(req.projectEnv, async () => {
        const mod = await loadPreparedModule(req.module, {
          logicalModuleId: req.modulePath,
          sourceIntegrationPolicy: req.sourceIntegrationPolicy,
          projectEnv: req.projectEnv,
        });
        return snapshotResolvedRouteMethods(
          resolveExecutableRouteMethods(mod, req.requestedMethod),
          false,
        );
      }),
  );
}

// ---------------------------------------------------------------------------
// SSR Rendering Handler
// ---------------------------------------------------------------------------

/**
 * Handle SSR rendering in the isolated Worker.
 *
 * Imports the page + layout components from their temp file paths,
 * constructs a React element tree (layouts wrapping page), and renders
 * to HTML string. For streaming, sends chunks via postMessage.
 *
 * The Worker gets its own React instance — safe because SSR is
 * self-contained (no hydration mismatch concern).
 */
async function handleRenderSSR(
  req: RenderSSRRequest,
): Promise<{ html: string } | "streaming"> {
  return await runWithWorkerSourceIntegrationPolicy(
    req.sourceIntegrationPolicy,
    async () => await renderSSR(req),
  );
}

async function renderSSR(
  req: RenderSSRRequest,
): Promise<{ html: string } | "streaming"> {
  // Load React only for SSR workers. API-only workers and health checks should
  // not pay the React import cost or contend on it under parallel worker tests.
  await ensureReactReady();

  if (!_React || !_ReactDOMServer) {
    throw new NativeError("React modules not available in this worker");
  }

  const React = _React;
  const { renderToString } = _ReactDOMServer;

  // Import the page component
  const pageMod = await loadModule(req.pageModulePath);
  const PageComponent = (pageMod.default ?? pageMod) as React.ComponentType<
    Record<string, unknown>
  >;

  // Import layout components (innermost → outermost order)
  const layoutComponents = new NativeArray<
    React.ComponentType<Record<string, unknown>>
  >(req.layoutModulePaths.length);
  for (let index = 0; index < req.layoutModulePaths.length; index++) {
    const layoutPath = req.layoutModulePaths[index]!;
    const layoutMod = await loadModule(layoutPath);
    defineDataProperty(
      layoutComponents,
      NativeString(index),
      (layoutMod.default ?? layoutMod) as React.ComponentType<
        Record<string, unknown>
      >,
    );
  }

  // Build element tree: page is innermost, layouts wrap outward
  const createElement = React.createElement as (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => React.ReactElement;

  let element: React.ReactElement = createElement(PageComponent, req.pageProps);

  for (let i = 0; i < layoutComponents.length; i++) {
    const Layout = layoutComponents[i];
    const layoutProps = req.layoutProps[i] ?? {};
    element = createElement(Layout, layoutProps, element);
  }

  // Streaming mode: send chunks via postMessage
  if (req.delivery === "stream") {
    // Use renderToReadableStream if available (React 18+)
    const serverModule = _ReactDOMServer as unknown as Record<string, unknown>;
    const renderToReadableStream = serverModule.renderToReadableStream as
      | ((element: React.ReactElement) => Promise<ReadableStream<Uint8Array>>)
      | undefined;

    if (renderToReadableStream) {
      const stream = await renderToReadableStream(element);
      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          const endMsg: WorkerStreamEnd = { type: "stream-end", id: req.id };
          sendControlMessage(endMsg);
          break;
        }
        const chunkMsg: WorkerStreamChunk = {
          type: "stream-chunk",
          id: req.id,
          chunk: value,
        };
        sendControlMessage(chunkMsg);
      }

      return "streaming";
    }

    // Fallback: render to string if streaming not available
  }

  // String mode (or streaming fallback): render to string
  const html = renderToString(element);
  return { html };
}

// ---------------------------------------------------------------------------
// Message Handler
// ---------------------------------------------------------------------------

async function processWorkerRequest(request: WorkerRequest): Promise<void> {
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

    // SSR rendering — may stream chunks or return HTML string
    if (request.type === "render-ssr") {
      const ssrResult = await handleRenderSSR(request);

      // If streaming, chunks were already sent via postMessage
      if (ssrResult === "streaming") return;

      const ssrResponse: WorkerSSRResultResponse = {
        type: "ssr-result",
        id: request.id,
        html: ssrResult.html,
      };
      sendControlMessage(ssrResponse);
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
    if (
      preparedFailure.failed ||
      error === WORKER_ENV_CLEANUP_ERROR
    ) {
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

function enqueueWorkerRequest(request: WorkerRequest): void {
  // Project code may mutate Promise.prototype after its first import. Invoke
  // the captured intrinsic directly so the serialized env overlay queue
  // remains framework-owned.
  requestQueue = apply(promiseThen, requestQueue, [
    () => processWorkerRequest(request),
    () => processWorkerRequest(request),
  ]) as Promise<void>;
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

  try {
    enqueueWorkerRequest(snapshotWorkerRequest(message));
  } catch (error) {
    sendControlMessage(
      {
        type: "error",
        id: snapshotControlMessageId(message),
        error: serializeError(error),
      } satisfies WorkerErrorResponse,
    );
  }
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
    [],
    "bootstrap",
  );
  if (readDataProperty(bootstrap, "type") !== "initialize-egress") return;

  const port = readDataProperty(bootstrap, "controlPort");
  if (!(port instanceof NativeMessagePort)) {
    throw new NativeTypeError("Invalid worker control port");
  }
  const options = cloneStructuredValue(
    readDataProperty(bootstrap, "options"),
  ) as WorkerEgressGuardOptions;

  workerControlPort = port;
  postControlPortMessage = (payload: unknown): void => {
    apply(messagePortPostMessage, port, [payload]);
  };
  apply(eventTargetAddEventListener, port, [
    "message",
    handleControlPortMessage as EventListener,
  ]);
  apply(messagePortStart, port, []);
  apply(eventTargetRemoveEventListener, self, [
    "message",
    handleWorkerBootstrapMessage as EventListener,
  ]);

  installWorkerExitNotifier();
  installWorkerEgressGuard(options);
  egressInitialized = true;
}

apply(eventTargetAddEventListener, self, [
  "message",
  handleWorkerBootstrapMessage as EventListener,
]);
