/** Structured context for build failures. */
export interface BuildContext {
  /** Source file involved in the failure. */
  file?: string;
  /** One-based source line. */
  line?: number;
  /** One-based source column. */
  column?: number;
  /** Module identifier involved in the failure. */
  moduleId?: string;
  /** Build phase that failed. */
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

/** Structured context for API failures. */
export interface APIContext {
  /** API endpoint without credentials. */
  endpoint?: string;
  /** HTTP method. */
  method?: string;
  /** HTTP status returned by the endpoint. */
  statusCode?: number;
  /** Sanitized response or request headers. */
  headers?: Record<string, string>;
}

/** Structured context for rendering failures. */
export interface RenderContext {
  /** Component display name. */
  component?: string;
  /** Application route. */
  route?: string;
  /** Rendering phase. */
  phase?: "server" | "client" | "hydration";
  /** Internal component properties. */
  props?: unknown;
}

/** Structured context for configuration failures. */
export interface ConfigContext {
  /** Configuration filename. */
  configFile?: string;
  /** Configuration field that failed validation. */
  field?: string;
  /** Rejected configuration value. */
  value?: unknown;
  /** Human-readable expected value. */
  expected?: string;
}

/** Structured context for agent failures. */
export interface AgentContext {
  /** Agent identifier. */
  agentId?: string;
  /** Requested agent intent. */
  intent?: string;
  /** Timeout in milliseconds. */
  timeout?: number;
}

/** Structured context for filesystem failures. */
export interface FileContext {
  /** File path involved in the operation. */
  path?: string;
  /** Filesystem operation that failed. */
  operation?: "read" | "write" | "delete" | "mkdir";
  /** Required or observed permissions. */
  permissions?: string;
}

/** Structured context for network failures. */
export interface NetworkContext {
  /** Credential-free request URL. */
  url?: string;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Number of completed retries. */
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

/** Preserve a typed serializable Veryfront error value. */
export function createError(error: VeryfrontErrorData): VeryfrontErrorData {
  if (!snapshotVeryfrontErrorData(error)) {
    throw new TypeError("Invalid Veryfront error data");
  }
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

type UnknownRecord = Record<string, unknown>;

const BUILD_PHASES: BuildContext["phase"][] = [
  "parse",
  "transform",
  "bundle",
  "optimize",
  "dependency-resolution",
  "circuit-breaker",
  "http-bundle-validation",
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOptionalField(
  value: UnknownRecord,
  field: string,
  isValid: (candidate: unknown) => boolean,
): boolean {
  const candidate = value[field];
  return candidate === undefined || isValid(candidate);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isString);
}

function isBuildContext(value: unknown): value is BuildContext {
  return isRecord(value) &&
    hasOptionalField(value, "file", isString) &&
    hasOptionalField(value, "line", isNumber) &&
    hasOptionalField(value, "column", isNumber) &&
    hasOptionalField(value, "moduleId", isString) &&
    hasOptionalField(
      value,
      "phase",
      (phase) => BUILD_PHASES.includes(phase as BuildContext["phase"]),
    ) &&
    hasOptionalField(value, "failures", isNumber) &&
    hasOptionalField(
      value,
      "missing",
      (missing) =>
        Array.isArray(missing) && missing.every((item) =>
          isRecord(item) &&
          isString(item.specifier) &&
          isString(item.fromFile) &&
          isString(item.reason)
        ),
    ) &&
    hasOptionalField(value, "failed", isStringArray) &&
    hasOptionalField(value, "cacheDir", isString);
}

function isAPIContext(value: unknown): value is APIContext {
  return isRecord(value) &&
    hasOptionalField(value, "endpoint", isString) &&
    hasOptionalField(value, "method", isString) &&
    hasOptionalField(value, "statusCode", isNumber) &&
    hasOptionalField(value, "headers", isStringRecord);
}

function isRenderContext(value: unknown): value is RenderContext {
  return isRecord(value) &&
    hasOptionalField(value, "component", isString) &&
    hasOptionalField(value, "route", isString) &&
    hasOptionalField(
      value,
      "phase",
      (phase) => phase === "server" || phase === "client" || phase === "hydration",
    );
}

function isConfigContext(value: unknown): value is ConfigContext {
  return isRecord(value) &&
    hasOptionalField(value, "configFile", isString) &&
    hasOptionalField(value, "field", isString) &&
    hasOptionalField(value, "expected", isString);
}

function isAgentContext(value: unknown): value is AgentContext {
  return isRecord(value) &&
    hasOptionalField(value, "agentId", isString) &&
    hasOptionalField(value, "intent", isString) &&
    hasOptionalField(value, "timeout", isNumber);
}

function isFileContext(value: unknown): value is FileContext {
  return isRecord(value) &&
    hasOptionalField(value, "path", isString) &&
    hasOptionalField(
      value,
      "operation",
      (operation) =>
        operation === "read" || operation === "write" || operation === "delete" ||
        operation === "mkdir",
    ) &&
    hasOptionalField(value, "permissions", isString);
}

function isNetworkContext(value: unknown): value is NetworkContext {
  return isRecord(value) &&
    hasOptionalField(value, "url", isString) &&
    hasOptionalField(value, "timeout", isNumber) &&
    hasOptionalField(value, "retryCount", isNumber);
}

function hasValidContext(
  value: UnknownRecord,
  isValid: (context: unknown) => boolean,
): boolean {
  const context = value.context;
  return context === undefined || isValid(context);
}

interface VeryfrontErrorDataSnapshot {
  message: string;
  type: VeryfrontErrorData["type"];
}

function snapshotVeryfrontErrorData(value: unknown): VeryfrontErrorDataSnapshot | null {
  try {
    if (!isRecord(value)) return null;
    const message = value.message;
    const type = value.type;
    if (!isString(message) || !isString(type)) return null;

    let valid = false;
    switch (type) {
      case "build":
        valid = hasValidContext(value, isBuildContext);
        break;
      case "api":
        valid = hasValidContext(value, isAPIContext);
        break;
      case "render":
        valid = hasValidContext(value, isRenderContext);
        break;
      case "config":
        valid = hasValidContext(value, isConfigContext);
        break;
      case "agent":
        valid = hasValidContext(value, isAgentContext);
        break;
      case "file":
      case "permission":
        valid = hasValidContext(value, isFileContext);
        break;
      case "network":
        valid = hasValidContext(value, isNetworkContext);
        break;
      case "not_supported":
        valid = hasOptionalField(value, "feature", isString);
        break;
      case "no_ai_available":
        valid = true;
        break;
    }
    return valid ? { message, type: type as VeryfrontErrorData["type"] } : null;
  } catch {
    return null;
  }
}

function isVeryfrontErrorData(value: unknown): value is VeryfrontErrorData {
  return snapshotVeryfrontErrorData(value) !== null;
}

/**
 * Convert a VeryfrontErrorData (plain object) to a throwable Error instance.
 *
 * Uses Error.captureStackTrace when available (V8 engines) to exclude toError()
 * from the stack trace, making the stack point to the actual call site.
 *
 * @see plans/architecture-audit/010.3-dual-veryfront-error-definitions.md
 */
export function toError(veryfrontError: VeryfrontErrorData): Error {
  const snapshot = snapshotVeryfrontErrorData(veryfrontError);
  if (!snapshot) throw new TypeError("Invalid Veryfront error data");
  const error = new Error(snapshot.message);
  error.name = `VeryfrontError[${snapshot.type}]`;

  // Capture stack at call site, excluding toError from the trace
  // This makes debugging easier by showing where createError+toError was called
  if (Error.captureStackTrace) Error.captureStackTrace(error, toError);

  Object.defineProperty(error, "context", {
    value: veryfrontError,
    enumerable: false,
    configurable: true,
  });

  return error;
}

/** Recover validated Veryfront error data attached by {@link toError}. */
export function fromError(error: unknown): VeryfrontErrorData | null {
  try {
    if (!isRecord(error)) return null;
    const context = error.context;
    return isVeryfrontErrorData(context) ? context : null;
  } catch {
    return null;
  }
}

const UNKNOWN_ERROR_MESSAGE = "Unknown error";

function isError(error: unknown): error is Error {
  try {
    return error instanceof Error;
  } catch {
    return false;
  }
}

/**
 * Extract error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  try {
    const message = isError(error) ? error.message : error;
    return typeof message === "string" ? message : String(message);
  } catch {
    return UNKNOWN_ERROR_MESSAGE;
  }
}

/**
 * Ensure error is an Error instance
 */
export function ensureError(error: unknown): Error {
  return isError(error) ? error : new Error(getErrorMessage(error));
}
