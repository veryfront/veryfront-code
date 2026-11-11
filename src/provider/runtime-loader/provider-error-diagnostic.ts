import { joinPrivateArray, pushPrivateArray } from "#veryfront/security/private-array.ts";
import { testPrivateRegExp } from "#veryfront/security/private-regexp.ts";
/** Safe, bounded fields from a provider's structured request rejection. */
export interface ProviderErrorDiagnostic {
  readonly type?: string;
  readonly code?: string;
  readonly param?: string;
}

const apply = Reflect.apply;
const freeze = Object.freeze;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const setHas = Set.prototype.has;
const diagnostics = new WeakMap<object, ProviderErrorDiagnostic>();

const allowedTypes = new Set([
  "invalid_request_error",
  "validation_error",
  "INVALID_ARGUMENT",
]);
const allowedCodes = new Set([
  "invalid_request_error",
  "invalid_tool_schema",
  "invalid_function_parameters",
  "invalid_json_schema",
  "context_length_exceeded",
  "invalid_value",
  "invalid_argument",
  "invalid_parameter",
  "missing_required_parameter",
  "unsupported_parameter",
  "model_not_found",
  "INVALID_ARGUMENT",
]);
const allowedPlainParams = new Set([
  "model",
  "max_tokens",
  "max_completion_tokens",
  "response_format",
  "tool_choice",
  "parallel_tool_calls",
  "temperature",
  "stream",
  "reasoning",
]);
const allowedToolParam =
  /^tools\[(?:0|[1-9]\d{0,2})\]\.(?:type|function\.(?:parameters|name|description))$/;
const allowedMessageParam = /^messages\[(?:0|[1-9]\d{0,3})\]\.(?:role|content)$/;

/** Retain only known protocol fields, never response text or user-defined paths. */
export function recordProviderErrorDiagnostic(
  error: Error,
  type: unknown,
  code: unknown,
  param: unknown,
): void {
  const safeType = typeof type === "string" && apply(setHas, allowedTypes, [type]) === true
    ? type
    : undefined;
  const safeCode = typeof code === "string" && apply(setHas, allowedCodes, [code]) === true
    ? code
    : undefined;
  const safeParam = typeof param === "string" && param.length <= 64 &&
      (apply(setHas, allowedPlainParams, [param]) === true ||
        testPrivateRegExp(allowedToolParam, param) ||
        testPrivateRegExp(allowedMessageParam, param))
    ? param
    : undefined;
  if (safeType === undefined && safeCode === undefined && safeParam === undefined) return;
  const diagnostic: ProviderErrorDiagnostic = {
    type: safeType,
    code: safeCode,
    param: safeParam,
  };
  // Freeze through the load-time intrinsic and store the validated object itself,
  // never a value returned by a replaced global.
  apply(freeze, undefined, [diagnostic]);
  apply(weakMapSet, diagnostics, [error, diagnostic]);
}

/** Return the trusted diagnostic captured when the provider error was built. */
export function readProviderErrorDiagnostic(error: unknown): ProviderErrorDiagnostic | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  return apply(weakMapGet, diagnostics, [error]) as ProviderErrorDiagnostic | undefined;
}

/** Public code for an unrecognised 4xx rejection of a model request. */
export const PROVIDER_REQUEST_REJECTED_CODE = "PROVIDER_REQUEST_REJECTED";

const REJECTION_PREFIX = "The model provider rejected the request with HTTP ";
const PARAMETER_PREFIX = "parameter ";
const PART_SEPARATOR = ", ";
const MAX_PARTS = 3;
const rejectionStatus = /^4\d\d$/;
const stringSlice = String.prototype.slice;
const stringIndexOf = String.prototype.indexOf;
const stringStartsWith = String.prototype.startsWith;
const stringEndsWith = String.prototype.endsWith;
const numberParseInt = Number.parseInt;

function isAllowlistedParam(param: string): boolean {
  return param.length <= 64 &&
    (apply(setHas, allowedPlainParams, [param]) === true ||
      testPrivateRegExp(allowedToolParam, param) ||
      testPrivateRegExp(allowedMessageParam, param));
}

function describeDiagnostic(diagnostic: ProviderErrorDiagnostic): string[] {
  // Private array helpers: project code can replace Array.prototype methods.
  const parts: string[] = [];
  if (diagnostic.type !== undefined) pushPrivateArray(parts, diagnostic.type);
  if (diagnostic.code !== undefined && diagnostic.code !== diagnostic.type) {
    pushPrivateArray(parts, diagnostic.code);
  }
  if (diagnostic.param !== undefined) {
    pushPrivateArray(parts, `${PARAMETER_PREFIX}${diagnostic.param}`);
  }
  return parts;
}

/**
 * Split on the separator without String.prototype.split, which dispatches
 * through a replaceable Symbol.split. Returns undefined past the part limit.
 */
function splitRejectionParts(inner: string): string[] | undefined {
  const parts: string[] = [];
  let start = 0;
  while (parts.length < MAX_PARTS) {
    const end = apply(stringIndexOf, inner, [PART_SEPARATOR, start]) as number;
    if (end === -1) {
      pushPrivateArray(parts, apply(stringSlice, inner, [start]) as string);
      return parts;
    }
    pushPrivateArray(parts, apply(stringSlice, inner, [start, end]) as string);
    start = end + PART_SEPARATOR.length;
  }
  return undefined;
}

function formatRejection(status: number, parts: readonly string[]): string {
  return parts.length > 0
    ? `${REJECTION_PREFIX}${status} (${joinPrivateArray(parts, PART_SEPARATOR)}).`
    : `${REJECTION_PREFIX}${status}.`;
}

/**
 * Name a rejected model request by its HTTP status and the allowlisted
 * protocol fields captured for `error`. Provider wording never reaches it.
 */
export function formatProviderRequestRejection(status: number, error: unknown): string {
  const diagnostic = readProviderErrorDiagnostic(error);
  return formatRejection(status, diagnostic === undefined ? [] : describeDiagnostic(diagnostic));
}

/**
 * Rebuild a rejection message received across a process or event boundary.
 *
 * Returns undefined unless every part matches the grammar and allowlists that
 * {@link formatProviderRequestRejection} produces, so a payload cannot use the
 * public code to carry other text.
 */
export function readProviderRequestRejectionMessage(message: unknown): string | undefined {
  if (
    typeof message !== "string" || message.length > 512 ||
    apply(stringStartsWith, message, [REJECTION_PREFIX]) !== true ||
    apply(stringEndsWith, message, ["."]) !== true
  ) {
    return undefined;
  }
  const rest = apply(stringSlice, message, [REJECTION_PREFIX.length, -1]) as string;
  const statusText = apply(stringSlice, rest, [0, 3]) as string;
  if (!testPrivateRegExp(rejectionStatus, statusText)) return undefined;
  const status = numberParseInt(statusText, 10);
  const tail = apply(stringSlice, rest, [3]) as string;
  if (tail === "") return formatRejection(status, []);
  if (
    apply(stringStartsWith, tail, [" ("]) !== true || apply(stringEndsWith, tail, [")"]) !== true
  ) {
    return undefined;
  }
  const inner = apply(stringSlice, tail, [2, -1]) as string;
  const parts = splitRejectionParts(inner);
  if (parts === undefined) return undefined;
  // Indexed, not for...of: project code can replace Array.prototype[Symbol.iterator].
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (apply(stringStartsWith, part, [PARAMETER_PREFIX]) === true) {
      if (!isAllowlistedParam(apply(stringSlice, part, [PARAMETER_PREFIX.length]) as string)) {
        return undefined;
      }
    } else if (
      apply(setHas, allowedTypes, [part]) !== true && apply(setHas, allowedCodes, [part]) !== true
    ) {
      return undefined;
    }
  }
  return formatRejection(status, parts);
}
