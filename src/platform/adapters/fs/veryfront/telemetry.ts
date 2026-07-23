import type { AttributeValue } from "#veryfront/observability/tracing/api-shim.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ERROR_REGISTRY } from "#veryfront/errors/error-registry.ts";
import { API_CLIENT_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { type RegisteredError, VeryfrontError } from "#veryfront/errors/types.ts";

const FILESYSTEM_SPAN_FAILURE = Symbol("filesystem operation failed");
const SAFE_API_ERROR_DETAIL_KEYS = new Set([
  "attempts",
  "issueCount",
  "maxFiles",
  "maxPages",
  "method",
  "operation",
  "route",
  "status",
]);
const UNSAFE_ERROR_TEXT =
  /(?:https?|wss?):\/\/|\bbearer\s+|\b(?:branch|cache[-_ ]?key|domain|entity|environment|path|project|release|source|token|url)\s*(?:=|:|['"`])/i;

export type FilesystemErrorClass =
  | "abort"
  | "error"
  | "range"
  | "type"
  | "veryfront"
  | "non-error";

/** Return a bounded error category without trusting caller-controlled names or messages. */
export function classifyFilesystemError(error: unknown): FilesystemErrorClass {
  if (error instanceof VeryfrontError) return "veryfront";
  if (error instanceof DOMException && error.name === "AbortError") return "abort";
  if (error instanceof TypeError) return "type";
  if (error instanceof RangeError) return "range";
  if (error instanceof Error) return "error";
  return "non-error";
}

export type FilesystemOperationReason =
  | "branch-miss"
  | "cache-miss"
  | "manual"
  | "external";

/** Collapse arbitrary caller-provided reasons into stable, non-identifying categories. */
export function classifyFilesystemReason(reason: string | undefined): FilesystemOperationReason {
  if (reason?.startsWith("branch-miss:")) return "branch-miss";
  if (reason?.toLowerCase().includes("miss")) return "cache-miss";
  if (reason === undefined || reason === "manual-refresh") return "manual";
  return "external";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSanitizedApiErrorContext(context: unknown): boolean {
  if (context === undefined) return true;
  if (!isRecord(context) || Object.keys(context).some((key) => key !== "details")) return false;

  const details = context.details;
  if (!isRecord(details)) return false;
  return Object.entries(details).every(([key, value]) =>
    SAFE_API_ERROR_DETAIL_KEYS.has(key) &&
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
  );
}

function hasSanitizedErrorText(value: string | undefined): boolean {
  return value === undefined || (value.length <= 512 && !UNSAFE_ERROR_TEXT.test(value));
}

function isSanitizedRegisteredError(error: VeryfrontError): boolean {
  if (!Object.hasOwn(ERROR_REGISTRY, error.slug)) return false;
  if (!Number.isInteger(error.status) || error.status < 400 || error.status > 599) return false;
  if (error.cause !== undefined || error.instance !== undefined) return false;
  if (!hasSanitizedErrorText(error.message) || !hasSanitizedErrorText(error.detail)) return false;
  return hasSanitizedApiErrorContext(error.context);
}

function inferFilesystemErrorStatus(error: unknown): number {
  if (error instanceof VeryfrontError) return error.status;

  if (isRecord(error) && error.code === "ENOENT") return 404;
  if (error instanceof DOMException && error.name === "AbortError") return 499;
  if (error instanceof Error && /\b404\b|\bnot found\b/i.test(error.message)) return 404;
  return 500;
}

function getFilesystemErrorDefinition(error: unknown): RegisteredError {
  if (!(error instanceof VeryfrontError) || !Object.hasOwn(ERROR_REGISTRY, error.slug)) {
    return API_CLIENT_ERROR;
  }
  return (ERROR_REGISTRY as Record<string, RegisteredError>)[error.slug] ?? API_CLIENT_ERROR;
}

/**
 * Keep registered errors that already satisfy the API client's sanitized
 * contract. Replace raw or identifier-bearing errors without copying their
 * message, cause, stack context, or customer data.
 */
export function toFilesystemPublicError(error: unknown): VeryfrontError {
  if (error instanceof VeryfrontError && isSanitizedRegisteredError(error)) return error;

  const status = inferFilesystemErrorStatus(error);
  const detail = status === 404
    ? "Filesystem resource was not found"
    : status === 400
    ? "Filesystem request was invalid"
    : status === 401 || status === 403
    ? "Filesystem operation was not authorized"
    : status === 499
    ? "Filesystem operation was cancelled"
    : "Filesystem operation failed";

  return getFilesystemErrorDefinition(error).create({ detail, status });
}

/**
 * Run an FS operation in a span without exporting raw path attributes or raw
 * exception messages and stacks. Raw errors are sanitized at the public FS boundary.
 */
export async function withFilesystemSpan<T>(
  name: string,
  operation: () => Promise<T>,
  attributes?: Record<string, AttributeValue>,
): Promise<T> {
  let failed = false;
  let operationError: unknown;

  try {
    return await withSpan(
      name,
      async () => {
        try {
          return await operation();
        } catch (error) {
          failed = true;
          operationError = toFilesystemPublicError(error);
          throw FILESYSTEM_SPAN_FAILURE;
        }
      },
      attributes,
    );
  } catch (error) {
    if (failed && error === FILESYSTEM_SPAN_FAILURE) throw operationError;
    throw toFilesystemPublicError(error);
  }
}
