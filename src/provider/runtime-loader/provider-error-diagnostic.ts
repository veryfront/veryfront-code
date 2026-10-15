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
  /^tools\[(?:0|[1-9][0-9]{0,2})\]\.(?:type|function\.(?:parameters|name|description))$/;
const allowedMessageParam = /^messages\[(?:0|[1-9][0-9]{0,3})\]\.(?:role|content)$/;

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
