import type { AttributeValue } from "./tracing/api-shim.ts";
import { sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

/** Bounded failure categories that are safe to use as telemetry dimensions. */
export type TelemetryErrorCategory =
  | "abort"
  | "aggregate_error"
  | "dom_error"
  | "error"
  | "eval_error"
  | "range_error"
  | "reference_error"
  | "syntax_error"
  | "timeout"
  | "type_error"
  | "uri_error"
  | "thrown_bigint"
  | "thrown_boolean"
  | "thrown_function"
  | "thrown_null"
  | "thrown_number"
  | "thrown_object"
  | "thrown_string"
  | "thrown_symbol"
  | "thrown_undefined";

const HTTP_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

const HTTP_SCHEMES = new Set(["http", "https"]);
const MAX_ROUTE_TEMPLATE_LENGTH = 256;
const MAX_TELEMETRY_NAME_LENGTH = 128;
const MAX_TELEMETRY_ATTRIBUTES = 32;
const MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH = 128;
const MAX_TELEMETRY_STRING_LENGTH = 256;
const MAX_TELEMETRY_ARRAY_LENGTH = 32;
const SAFE_ROUTE_TEMPLATE =
  /^\/(?:[A-Za-z0-9._~-]+|:[A-Za-z][A-Za-z0-9_]*|\{[A-Za-z][A-Za-z0-9_]*\})(?:\/(?:[A-Za-z0-9._~-]+|:[A-Za-z][A-Za-z0-9_]*|\{[A-Za-z][A-Za-z0-9_]*\}))*\/?$/;

type SanitizedErrorSpan = {
  setAttributes(attributes: Record<string, AttributeValue>): unknown;
  setStatus(status: { code: number; message?: string }): unknown;
};

/** Convert an arbitrary HTTP method into a bounded telemetry value. */
export function normalizeHttpMethod(method: unknown): string {
  if (typeof method !== "string") return "OTHER";
  const normalized = method.toUpperCase();
  return HTTP_METHODS.has(normalized) ? normalized : "OTHER";
}

/** Return a safe scheme or undefined for non-HTTP and malformed URLs. */
export function extractSafeHttpScheme(url: unknown): "http" | "https" | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const scheme = new URL(url).protocol.slice(0, -1).toLowerCase();
    return HTTP_SCHEMES.has(scheme) ? scheme as "http" | "https" : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validate an explicitly supplied, code-owned route template.
 *
 * Request URLs and concrete paths must not be passed here. A rejected value is
 * omitted rather than partially redacted because any literal can be customer data.
 */
export function normalizeRouteTemplate(routeTemplate: unknown): string | undefined {
  if (
    typeof routeTemplate !== "string" || routeTemplate.length === 0 ||
    routeTemplate.length > MAX_ROUTE_TEMPLATE_LENGTH
  ) {
    return undefined;
  }

  if (routeTemplate === "/") return routeTemplate;
  return SAFE_ROUTE_TEMPLATE.test(routeTemplate) ? routeTemplate : undefined;
}

/** Normalize a caller-controlled span or event name to a bounded value. */
export function normalizeTelemetryName(name: unknown): string {
  if (typeof name !== "string") return "operation";
  const normalized = stripTelemetryControlCharacters(name).slice(0, MAX_TELEMETRY_NAME_LENGTH);
  return normalized || "operation";
}

/** Remove C0 and DEL control characters from telemetry text. */
export function stripTelemetryControlCharacters(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code < 32 || code === 127 || (code >= 128 && code <= 159) || code === 0x200e ||
      code === 0x200f || (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) continue;
    output += value[index];
  }
  return output;
}

function sanitizeAttributeValue(value: unknown): AttributeValue {
  if (typeof value === "string") {
    return sanitizeUrlCredentials(value).slice(0, MAX_TELEMETRY_STRING_LENGTH);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (!Array.isArray(value)) return undefined;

  const output: Array<string | number | boolean> = [];
  try {
    for (const item of value.slice(0, MAX_TELEMETRY_ARRAY_LENGTH)) {
      if (typeof item === "string") {
        output.push(sanitizeUrlCredentials(item).slice(0, MAX_TELEMETRY_STRING_LENGTH));
      } else if (typeof item === "number" && Number.isFinite(item)) {
        output.push(item);
      } else if (typeof item === "boolean") {
        output.push(item);
      }
    }
  } catch {
    return undefined;
  }
  return output.length > 0 ? output : undefined;
}

/** Return a bounded snapshot suitable for a span attribute hook. */
export function sanitizeTelemetryAttributes(
  attributes: unknown,
): Record<string, AttributeValue> {
  if (!attributes || typeof attributes !== "object") return {};
  const output: Record<string, AttributeValue> = {};
  try {
    for (const [key, value] of Object.entries(attributes)) {
      if (Object.keys(output).length >= MAX_TELEMETRY_ATTRIBUTES) break;
      if (
        key.length === 0 || key.length > MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH ||
        hasUnsafeControlCharacters(key)
      ) {
        continue;
      }
      const sanitized = sanitizeAttributeValue(value);
      if (sanitized !== undefined) output[key] = sanitized;
    }
  } catch {
    return {};
  }
  return output;
}

/** Classify arbitrary thrown values without reading messages, stacks, or causes. */
export function classifyTelemetryError(error: unknown): TelemetryErrorCategory {
  if (error === null) return "thrown_null";

  try {
    if (typeof DOMException !== "undefined" && error instanceof DOMException) {
      try {
        if (error.name === "AbortError") return "abort";
        if (error.name === "TimeoutError") return "timeout";
      } catch {
        // A hostile subclass can override name. Keep the bounded generic class.
      }
      return "dom_error";
    }
    if (error instanceof AggregateError) return "aggregate_error";
    if (error instanceof TypeError) return "type_error";
    if (error instanceof RangeError) return "range_error";
    if (error instanceof ReferenceError) return "reference_error";
    if (error instanceof SyntaxError) return "syntax_error";
    if (error instanceof URIError) return "uri_error";
    if (error instanceof EvalError) return "eval_error";
    if (error instanceof Error) return "error";
  } catch {
    // Proxies and custom Symbol.hasInstance hooks must fail closed.
  }

  switch (typeof error) {
    case "bigint":
      return "thrown_bigint";
    case "boolean":
      return "thrown_boolean";
    case "function":
      return "thrown_function";
    case "number":
      return "thrown_number";
    case "object":
      return "thrown_object";
    case "string":
      return "thrown_string";
    case "symbol":
      return "thrown_symbol";
    case "undefined":
      return "thrown_undefined";
    default:
      return "thrown_undefined";
  }
}

/** Mark a span as failed using bounded data. Tracer hook failures are ignored. */
export function setSanitizedSpanError(
  span: SanitizedErrorSpan | null | undefined,
  statusCode: number,
  error: unknown,
): void {
  if (!span) return;
  const category = classifyTelemetryError(error);

  try {
    span.setAttributes({
      error: true,
      "error.category": category,
      "error.type": category,
    });
  } catch {
    // Telemetry must not affect application behavior.
  }

  try {
    span.setStatus({ code: statusCode });
  } catch {
    // Telemetry must not affect application behavior.
  }
}

/** Run one span hook without allowing exporter failures into application code. */
export function runSpanHook(hook: () => unknown): void {
  try {
    hook();
  } catch {
    // Telemetry must not affect application behavior.
  }
}
