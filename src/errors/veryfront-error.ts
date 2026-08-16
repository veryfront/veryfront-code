import {
  isVeryfrontErrorInstance,
  snapshotKnownVeryfrontError,
  VeryfrontError,
  type VeryfrontErrorSnapshot,
} from "./types.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const objectEntries = Object.entries;
const objectPrototype = Object.prototype;
const numberIsFinite = Number.isFinite;
const NativeArray = Array;
const NativeError = Error;
const NativeSet = Set;
const NativeString = String;
const captureStackTrace = Error.captureStackTrace;

export interface BuildContext {
  file?: string;
  line?: number;
  column?: number;
  moduleId?: string;
  phase?:
    | "parse"
    | "transform"
    | "bundle"
    | "optimize"
    | "dependency-resolution"
    | "circuit-breaker"
    | "http-bundle-validation";
  /** Number of failures (for circuit breaker) */
  failures?: number;
  /** Missing dependencies list */
  missing?: Array<{ specifier: string; fromFile: string; reason: string }>;
  /** Failed HTTP bundle specifiers */
  failed?: string[];
  /** Cache directory path */
  cacheDir?: string;
}

export interface APIContext {
  endpoint?: string;
  method?: string;
  statusCode?: number;
  headers?: Record<string, string>;
}

export interface RenderContext {
  component?: string;
  route?: string;
  phase?: "server" | "client" | "hydration";
  props?: unknown;
}

export interface ConfigContext {
  configFile?: string;
  field?: string;
  value?: unknown;
  expected?: string;
}

export interface AgentContext {
  agentId?: string;
  intent?: string;
  timeout?: number;
}

export interface FileContext {
  path?: string;
  operation?: "read" | "write" | "delete" | "mkdir";
  permissions?: string;
}

interface NetworkContext {
  url?: string;
  timeout?: number;
  retryCount?: number;
}

/**
 * Discriminated union for serializable error data.
 *
 * This represents error DATA (plain objects), not throwable errors.
 * For throwable errors, use `VeryfrontError` class from `./types.ts`.
 */
export type VeryfrontErrorData =
  | { type: "build"; message: string; context?: BuildContext }
  | { type: "api"; message: string; context?: APIContext }
  | { type: "render"; message: string; context?: RenderContext }
  | { type: "config"; message: string; context?: ConfigContext }
  | { type: "agent"; message: string; context?: AgentContext }
  | { type: "file"; message: string; context?: FileContext }
  | { type: "network"; message: string; context?: NetworkContext }
  | { type: "permission"; message: string; context?: FileContext }
  | { type: "not_supported"; message: string; feature?: string }
  | { type: "no_ai_available"; message: string };

export function createError(error: VeryfrontErrorData): VeryfrontErrorData {
  return error;
}

/** Type guard factory for VeryfrontErrorData types */
function isErrorType<T extends VeryfrontErrorData["type"]>(
  type: T,
): (error: VeryfrontErrorData) => error is Extract<VeryfrontErrorData, { type: T }> {
  return (error): error is Extract<VeryfrontErrorData, { type: T }> => error.type === type;
}

export const isBuildError = isErrorType("build");
export const isAPIError = isErrorType("api");
export const isRenderError = isErrorType("render");
export const isConfigError = isErrorType("config");
export const isFileError = isErrorType("file");
export const isNetworkError = isErrorType("network");

const SNAPSHOT_FAILED = Symbol("snapshot-failed");
const INVALID_ERROR_DATA = Symbol("invalid-error-data");
const MAX_SNAPSHOT_DEPTH = 16;
const MAX_SNAPSHOT_ENTRIES = 10_000;
const standardIsError = getOwnPropertyDescriptor(NativeError, "isError")?.value;

function hasNativeErrorBrand(error: unknown): error is Error {
  if (typeof standardIsError === "function") {
    try {
      return apply(standardIsError, NativeError, [error]) as boolean;
    } catch {
      return false;
    }
  }

  // Compatibility path for engines predating Error.isError. Modern runtimes
  // use the hook-free brand check above.
  try {
    return error instanceof NativeError;
  } catch {
    return false;
  }
}

interface SnapshotState {
  readonly seen: Set<object>;
  readonly isProxy: (value: object) => boolean;
  remainingEntries: number;
}

function snapshotPlainValue(
  value: unknown,
  depth: number,
  state: SnapshotState,
): unknown | typeof SNAPSHOT_FAILED {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (
    typeof value !== "object" ||
    depth >= MAX_SNAPSHOT_DEPTH ||
    state.seen.has(value) ||
    state.isProxy(value)
  ) {
    return SNAPSHOT_FAILED;
  }

  state.seen.add(value);
  try {
    if (arrayIsArray(value)) {
      const descriptors: Record<string, PropertyDescriptor> = getOwnPropertyDescriptors(value);
      const lengthDescriptor = descriptors["length"];
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        typeof lengthDescriptor.value !== "number" ||
        lengthDescriptor.value > state.remainingEntries
      ) {
        return SNAPSHOT_FAILED;
      }
      state.remainingEntries -= lengthDescriptor.value;
      const result = new NativeArray(lengthDescriptor.value);
      for (let index = 0; index < lengthDescriptor.value; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) continue;
        if (!("value" in descriptor)) return SNAPSHOT_FAILED;
        const child = snapshotPlainValue(descriptor.value, depth + 1, state);
        if (child === SNAPSHOT_FAILED) return SNAPSHOT_FAILED;
        result[index] = child;
      }
      return result;
    }

    const prototype = getPrototypeOf(value);
    if (prototype !== objectPrototype && prototype !== null) return SNAPSHOT_FAILED;

    const descriptors = getOwnPropertyDescriptors(value);
    const entries = objectEntries(descriptors).filter(([, descriptor]) => descriptor.enumerable);
    if (entries.length > state.remainingEntries) return SNAPSHOT_FAILED;
    state.remainingEntries -= entries.length;

    const result: Record<string, unknown> = {};
    for (const [key, descriptor] of entries) {
      if (!("value" in descriptor)) return SNAPSHOT_FAILED;
      const child = snapshotPlainValue(descriptor.value, depth + 1, state);
      if (child === SNAPSHOT_FAILED) return SNAPSHOT_FAILED;
      defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: child,
        writable: true,
      });
    }
    return result;
  } catch {
    return SNAPSHOT_FAILED;
  } finally {
    state.seen.delete(value);
  }
}

type InvalidErrorData = typeof INVALID_ERROR_DATA;
type OptionalField<T> = T | undefined | InvalidErrorData;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !arrayIsArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && numberIsFinite(value);
}

function optionalField<T>(
  source: Record<string, unknown>,
  key: string,
  predicate: (value: unknown) => value is T,
): OptionalField<T> {
  if (!hasOwn(source, key) || source[key] === undefined) return undefined;
  return predicate(source[key]) ? source[key] : INVALID_ERROR_DATA;
}

function optionalContext<T>(
  source: Record<string, unknown>,
  normalize: (value: unknown) => T | InvalidErrorData,
): OptionalField<T> {
  if (!hasOwn(source, "context") || source.context === undefined) {
    return undefined;
  }
  return normalize(source.context);
}

function normalizeStringArray(value: unknown): string[] | InvalidErrorData {
  if (!arrayIsArray(value)) return INVALID_ERROR_DATA;
  const normalized: string[] = [];
  for (const entry of value) {
    if (!isString(entry)) return INVALID_ERROR_DATA;
    normalized.push(entry);
  }
  return normalized;
}

function normalizeMissingDependencies(
  value: unknown,
): BuildContext["missing"] | InvalidErrorData {
  if (!arrayIsArray(value)) return INVALID_ERROR_DATA;

  const normalized: NonNullable<BuildContext["missing"]> = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.specifier !== "string" ||
      typeof entry.fromFile !== "string" ||
      typeof entry.reason !== "string"
    ) {
      return INVALID_ERROR_DATA;
    }
    normalized.push({
      specifier: entry.specifier,
      fromFile: entry.fromFile,
      reason: entry.reason,
    });
  }
  return normalized;
}

const BUILD_PHASES: ReadonlySet<NonNullable<BuildContext["phase"]>> = new NativeSet([
  "parse",
  "transform",
  "bundle",
  "optimize",
  "dependency-resolution",
  "circuit-breaker",
  "http-bundle-validation",
]);

function isBuildPhase(value: unknown): value is NonNullable<BuildContext["phase"]> {
  return typeof value === "string" &&
    BUILD_PHASES.has(value as NonNullable<BuildContext["phase"]>);
}

function normalizeBuildContext(value: unknown): BuildContext | InvalidErrorData {
  if (!isRecord(value)) return INVALID_ERROR_DATA;

  const file = optionalField(value, "file", isString);
  const line = optionalField(value, "line", isFiniteNumber);
  const column = optionalField(value, "column", isFiniteNumber);
  const moduleId = optionalField(value, "moduleId", isString);
  const phase = optionalField(value, "phase", isBuildPhase);
  const failures = optionalField(value, "failures", isFiniteNumber);
  const missing = optionalField(value, "missing", arrayIsArray);
  const failed = optionalField(value, "failed", arrayIsArray);
  const cacheDir = optionalField(value, "cacheDir", isString);
  if (
    file === INVALID_ERROR_DATA ||
    line === INVALID_ERROR_DATA ||
    column === INVALID_ERROR_DATA ||
    moduleId === INVALID_ERROR_DATA ||
    phase === INVALID_ERROR_DATA ||
    failures === INVALID_ERROR_DATA ||
    missing === INVALID_ERROR_DATA ||
    failed === INVALID_ERROR_DATA ||
    cacheDir === INVALID_ERROR_DATA
  ) {
    return INVALID_ERROR_DATA;
  }

  const normalizedMissing = missing === undefined
    ? undefined
    : normalizeMissingDependencies(missing);
  const normalizedFailed = failed === undefined ? undefined : normalizeStringArray(failed);
  if (
    normalizedMissing === INVALID_ERROR_DATA ||
    normalizedFailed === INVALID_ERROR_DATA
  ) {
    return INVALID_ERROR_DATA;
  }

  const normalized: BuildContext = {};
  if (file !== undefined) normalized.file = file;
  if (line !== undefined) normalized.line = line;
  if (column !== undefined) normalized.column = column;
  if (moduleId !== undefined) normalized.moduleId = moduleId;
  if (phase !== undefined) normalized.phase = phase;
  if (failures !== undefined) normalized.failures = failures;
  if (normalizedMissing !== undefined) normalized.missing = normalizedMissing;
  if (normalizedFailed !== undefined) normalized.failed = normalizedFailed;
  if (cacheDir !== undefined) normalized.cacheDir = cacheDir;
  return normalized;
}

function normalizeHeaders(
  value: unknown,
): Record<string, string> | InvalidErrorData {
  if (!isRecord(value)) return INVALID_ERROR_DATA;

  const headers: Record<string, string> = createObject(null);
  for (const [name, headerValue] of objectEntries(value)) {
    if (typeof headerValue !== "string") return INVALID_ERROR_DATA;
    headers[name] = headerValue;
  }
  return headers;
}

function normalizeAPIContext(value: unknown): APIContext | InvalidErrorData {
  if (!isRecord(value)) return INVALID_ERROR_DATA;

  const endpoint = optionalField(value, "endpoint", isString);
  const method = optionalField(value, "method", isString);
  const statusCode = optionalField(value, "statusCode", isFiniteNumber);
  const headersValue = optionalField(value, "headers", isRecord);
  if (
    endpoint === INVALID_ERROR_DATA ||
    method === INVALID_ERROR_DATA ||
    statusCode === INVALID_ERROR_DATA ||
    headersValue === INVALID_ERROR_DATA
  ) {
    return INVALID_ERROR_DATA;
  }

  const headers = headersValue === undefined ? undefined : normalizeHeaders(headersValue);
  if (headers === INVALID_ERROR_DATA) return INVALID_ERROR_DATA;
  const normalized: APIContext = {};
  if (endpoint !== undefined) normalized.endpoint = endpoint;
  if (method !== undefined) normalized.method = method;
  if (statusCode !== undefined) normalized.statusCode = statusCode;
  if (headers !== undefined) normalized.headers = headers;
  return normalized;
}

const RENDER_PHASES: ReadonlySet<NonNullable<RenderContext["phase"]>> = new NativeSet([
  "server",
  "client",
  "hydration",
]);

function isRenderPhase(value: unknown): value is NonNullable<RenderContext["phase"]> {
  return typeof value === "string" &&
    RENDER_PHASES.has(value as NonNullable<RenderContext["phase"]>);
}

function normalizeRenderContext(value: unknown): RenderContext | InvalidErrorData {
  if (!isRecord(value)) return INVALID_ERROR_DATA;

  const component = optionalField(value, "component", isString);
  const route = optionalField(value, "route", isString);
  const phase = optionalField(value, "phase", isRenderPhase);
  if (
    component === INVALID_ERROR_DATA ||
    route === INVALID_ERROR_DATA ||
    phase === INVALID_ERROR_DATA
  ) {
    return INVALID_ERROR_DATA;
  }

  const normalized: RenderContext = {};
  if (component !== undefined) normalized.component = component;
  if (route !== undefined) normalized.route = route;
  if (phase !== undefined) normalized.phase = phase;
  if (hasOwn(value, "props") && value.props !== undefined) {
    normalized.props = value.props;
  }
  return normalized;
}

function normalizeConfigContext(value: unknown): ConfigContext | InvalidErrorData {
  if (!isRecord(value)) return INVALID_ERROR_DATA;

  const configFile = optionalField(value, "configFile", isString);
  const field = optionalField(value, "field", isString);
  const expected = optionalField(value, "expected", isString);
  if (
    configFile === INVALID_ERROR_DATA ||
    field === INVALID_ERROR_DATA ||
    expected === INVALID_ERROR_DATA
  ) {
    return INVALID_ERROR_DATA;
  }

  const normalized: ConfigContext = {};
  if (configFile !== undefined) normalized.configFile = configFile;
  if (field !== undefined) normalized.field = field;
  if (hasOwn(value, "value") && value.value !== undefined) {
    normalized.value = value.value;
  }
  if (expected !== undefined) normalized.expected = expected;
  return normalized;
}

function normalizeAgentContext(value: unknown): AgentContext | InvalidErrorData {
  if (!isRecord(value)) return INVALID_ERROR_DATA;

  const agentId = optionalField(value, "agentId", isString);
  const intent = optionalField(value, "intent", isString);
  const timeout = optionalField(value, "timeout", isFiniteNumber);
  if (
    agentId === INVALID_ERROR_DATA ||
    intent === INVALID_ERROR_DATA ||
    timeout === INVALID_ERROR_DATA
  ) {
    return INVALID_ERROR_DATA;
  }
  const normalized: AgentContext = {};
  if (agentId !== undefined) normalized.agentId = agentId;
  if (intent !== undefined) normalized.intent = intent;
  if (timeout !== undefined) normalized.timeout = timeout;
  return normalized;
}

const FILE_OPERATIONS: ReadonlySet<NonNullable<FileContext["operation"]>> = new NativeSet([
  "read",
  "write",
  "delete",
  "mkdir",
]);

function isFileOperation(value: unknown): value is NonNullable<FileContext["operation"]> {
  return typeof value === "string" &&
    FILE_OPERATIONS.has(value as NonNullable<FileContext["operation"]>);
}

function normalizeFileContext(value: unknown): FileContext | InvalidErrorData {
  if (!isRecord(value)) return INVALID_ERROR_DATA;

  const path = optionalField(value, "path", isString);
  const operation = optionalField(value, "operation", isFileOperation);
  const permissions = optionalField(value, "permissions", isString);
  if (
    path === INVALID_ERROR_DATA ||
    operation === INVALID_ERROR_DATA ||
    permissions === INVALID_ERROR_DATA
  ) {
    return INVALID_ERROR_DATA;
  }
  const normalized: FileContext = {};
  if (path !== undefined) normalized.path = path;
  if (operation !== undefined) normalized.operation = operation;
  if (permissions !== undefined) normalized.permissions = permissions;
  return normalized;
}

function normalizeNetworkContext(
  value: unknown,
): NetworkContext | InvalidErrorData {
  if (!isRecord(value)) return INVALID_ERROR_DATA;

  const url = optionalField(value, "url", isString);
  const timeout = optionalField(value, "timeout", isFiniteNumber);
  const retryCount = optionalField(value, "retryCount", isFiniteNumber);
  if (
    url === INVALID_ERROR_DATA ||
    timeout === INVALID_ERROR_DATA ||
    retryCount === INVALID_ERROR_DATA
  ) {
    return INVALID_ERROR_DATA;
  }
  const normalized: NetworkContext = {};
  if (url !== undefined) normalized.url = url;
  if (timeout !== undefined) normalized.timeout = timeout;
  if (retryCount !== undefined) normalized.retryCount = retryCount;
  return normalized;
}

function normalizeErrorData(
  source: Record<string, unknown>,
): VeryfrontErrorData | null {
  if (typeof source.message !== "string") return null;
  const message = source.message;

  switch (source.type) {
    case "build": {
      const context = optionalContext(source, normalizeBuildContext);
      if (context === INVALID_ERROR_DATA) return null;
      return context === undefined
        ? { type: "build", message }
        : { type: "build", message, context };
    }
    case "api": {
      const context = optionalContext(source, normalizeAPIContext);
      if (context === INVALID_ERROR_DATA) return null;
      return context === undefined ? { type: "api", message } : { type: "api", message, context };
    }
    case "render": {
      const context = optionalContext(source, normalizeRenderContext);
      if (context === INVALID_ERROR_DATA) return null;
      return context === undefined
        ? { type: "render", message }
        : { type: "render", message, context };
    }
    case "config": {
      const context = optionalContext(source, normalizeConfigContext);
      if (context === INVALID_ERROR_DATA) return null;
      return context === undefined
        ? { type: "config", message }
        : { type: "config", message, context };
    }
    case "agent": {
      const context = optionalContext(source, normalizeAgentContext);
      if (context === INVALID_ERROR_DATA) return null;
      return context === undefined
        ? { type: "agent", message }
        : { type: "agent", message, context };
    }
    case "file": {
      const context = optionalContext(source, normalizeFileContext);
      if (context === INVALID_ERROR_DATA) return null;
      return context === undefined ? { type: "file", message } : { type: "file", message, context };
    }
    case "network": {
      const context = optionalContext(source, normalizeNetworkContext);
      if (context === INVALID_ERROR_DATA) return null;
      return context === undefined
        ? { type: "network", message }
        : { type: "network", message, context };
    }
    case "permission": {
      const context = optionalContext(source, normalizeFileContext);
      if (context === INVALID_ERROR_DATA) return null;
      return context === undefined
        ? { type: "permission", message }
        : { type: "permission", message, context };
    }
    case "not_supported": {
      const feature = optionalField(source, "feature", isString);
      if (feature === INVALID_ERROR_DATA) return null;
      return feature === undefined
        ? { type: "not_supported", message }
        : { type: "not_supported", message, feature };
    }
    case "no_ai_available":
      return { type: "no_ai_available", message };
    default:
      return null;
  }
}

/**
 * Convert a VeryfrontErrorData (plain object) to a throwable Error instance.
 *
 * Uses Error.captureStackTrace when available (V8 engines) to exclude toError()
 * from the stack trace, making the stack point to the actual call site.
 * An optional native error constructor preserves categories such as
 * `TypeError` while retaining the structured Veryfront error context.
 *
 * @see plans/architecture-audit/010.3-dual-veryfront-error-definitions.md
 */
export function toError(veryfrontError: VeryfrontErrorData): Error;
export function toError<T extends Error>(
  veryfrontError: VeryfrontErrorData,
  ErrorType: new (message?: string) => T,
): T;
export function toError(
  veryfrontError: VeryfrontErrorData,
  ErrorType: new (message?: string) => Error = NativeError,
): Error {
  const error = new ErrorType(veryfrontError.message);
  error.name = `VeryfrontError[${veryfrontError.type}]`;

  // Capture stack at call site, excluding toError from the trace
  // This makes debugging easier by showing where createError+toError was called
  if (captureStackTrace) {
    apply(captureStackTrace, NativeError, [error, toError]);
  }

  defineProperty(error, "context", {
    value: veryfrontError,
    enumerable: false,
    configurable: true,
  });

  return error;
}

/** @internal Decode one already-extracted legacy context value. */
export function decodeVeryfrontErrorData(
  contextValue: unknown,
  isProxy: (value: object) => boolean,
): VeryfrontErrorData | null {
  try {
    const context = snapshotPlainValue(contextValue, 0, {
      isProxy,
      seen: new NativeSet<object>(),
      remainingEntries: MAX_SNAPSHOT_ENTRIES,
    });
    if (
      context === SNAPSHOT_FAILED ||
      !context ||
      typeof context !== "object" ||
      arrayIsArray(context)
    ) {
      return null;
    }

    return normalizeErrorData(context as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Extract error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  try {
    if (isErrorInstance(error)) {
      const message = error.message;
      return typeof message === "string" ? message : "Unknown error";
    }
    return NativeString(error);
  } catch {
    return "Unknown error";
  }
}

/** Runtime-safe native Error guard for values caught from untrusted code. */
export function isErrorInstance(error: unknown): error is Error {
  return hasNativeErrorBrand(error);
}

export interface ErrorSnapshot {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/** Snapshot a native Error without retaining a proxy or invoking it again later. */
export function snapshotError(error: unknown): ErrorSnapshot | null {
  if (!isErrorInstance(error)) return null;
  return snapshotKnownError(error);
}

export function snapshotKnownError(error: Error): ErrorSnapshot | null {
  try {
    const descriptors = getOwnPropertyDescriptors(error);
    const ownDataValue = (key: string): unknown => {
      const descriptor = descriptors[key];
      return descriptor && "value" in descriptor ? descriptor.value : undefined;
    };
    const ownName = ownDataValue("name");
    const ownMessage = ownDataValue("message");
    const ownStack = ownDataValue("stack");
    const prototype = getPrototypeOf(error);
    const prototypeName = prototype !== null
      ? getOwnPropertyDescriptor(prototype, "name")
      : undefined;
    const name = ownName === undefined &&
        prototypeName &&
        "value" in prototypeName &&
        typeof prototypeName.value === "string"
      ? prototypeName.value
      : ownName ?? "Error";
    const message = ownMessage === undefined ? "" : ownMessage;
    const stack = ownStack === undefined ? undefined : ownStack;
    if (
      typeof name !== "string" ||
      typeof message !== "string" ||
      (stack !== undefined && typeof stack !== "string")
    ) {
      return null;
    }
    return { name, message, stack };
  } catch {
    return null;
  }
}

function applySnapshotStack(error: Error, stack: string | undefined): void {
  if (stack === undefined) return;
  defineProperty(error, "stack", {
    configurable: true,
    value: stack,
    writable: true,
  });
}

function detachVeryfrontError(snapshot: VeryfrontErrorSnapshot): VeryfrontError {
  const detached = new VeryfrontError(snapshot.message, {
    slug: snapshot.slug,
    category: snapshot.category,
    status: snapshot.status,
    title: snapshot.title,
    suggestion: snapshot.suggestion,
    exitCode: snapshot.exitCode,
    detail: snapshot.detail,
    cause: snapshot.cause,
    instance: snapshot.instance,
    context: snapshot.context,
  });
  applySnapshotStack(detached, snapshot.stack);
  return detached;
}

function copyOwnDataProperties(source: Error, target: Error): void {
  try {
    const descriptors = getOwnPropertyDescriptors(source);
    for (const [key, descriptor] of objectEntries(descriptors)) {
      if (key === "name" || key === "message" || key === "stack") continue;
      if (!("value" in descriptor)) continue;
      defineProperty(target, key, {
        configurable: true,
        enumerable: descriptor.enumerable,
        value: descriptor.value,
        writable: true,
      });
    }
  } catch {
    // Core fields were already detached. Unreadable optional metadata is omitted.
  }
}

function detachNativeError(source: Error, snapshot: ErrorSnapshot): Error {
  const detached = new NativeError(snapshot.message);
  detached.name = snapshot.name;
  applySnapshotStack(detached, snapshot.stack);
  copyOwnDataProperties(source, detached);
  return detached;
}

/**
 * Normalize a thrown value into a detached Error snapshot.
 *
 * Use this at boundaries that retain or repeatedly inspect the result. A
 * transparent Proxy can pass `instanceof Error` while throwing or changing
 * values on a later property read.
 */
export function snapshotErrorAsError(error: unknown): Error {
  if (isVeryfrontErrorInstance(error)) {
    const veryfrontSnapshot = snapshotKnownVeryfrontError(error);
    return veryfrontSnapshot
      ? detachVeryfrontError(veryfrontSnapshot)
      : new NativeError("Unknown error");
  }

  if (isErrorInstance(error)) {
    const nativeSnapshot = snapshotKnownError(error);
    return nativeSnapshot
      ? detachNativeError(error, nativeSnapshot)
      : new NativeError("Unknown error");
  }

  return new NativeError(safePrimitiveErrorMessage(error));
}

function safePrimitiveErrorMessage(error: unknown): string {
  if (
    (typeof error === "object" && error !== null) ||
    typeof error === "function"
  ) {
    return "Unknown error";
  }
  try {
    return NativeString(error);
  } catch {
    return "Unknown error";
  }
}

/**
 * Ensure a value is an Error while preserving the established identity
 * contract for ordinary Error instances.
 */
export function ensureError(error: unknown): Error {
  if (isErrorInstance(error)) {
    return snapshotError(error) ? error : new NativeError("Unknown error");
  }
  return new NativeError(safePrimitiveErrorMessage(error));
}
