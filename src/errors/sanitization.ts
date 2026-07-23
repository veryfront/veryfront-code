import {
  REDACTED,
  redactSensitive,
  sanitizeUrlCredentials,
  sanitizeUrlForSpan,
} from "#veryfront/utils/logger/redact.ts";
import { stripUnsafeControlCharacters } from "./text-validation.ts";

const LOCAL_PATH = "<LOCAL_PATH>";
const DEFAULT_MAX_TEXT_LENGTH = 4_096;
const MAX_SANITIZED_TEXT_LENGTH = 65_536;
const SANITIZATION_LOOKAHEAD_LENGTH = 4_096;
const MAX_CONTEXT_DEPTH = 16;
const MAX_CONTEXT_NODES = 2_048;
const TRUNCATION_MARKER = "[TRUNCATED]";

function truncateSanitizedText(
  output: string,
  boundedLength: number,
  forceMarker = false,
): string {
  if (!forceMarker && output.length <= boundedLength) return output;
  if (boundedLength <= TRUNCATION_MARKER.length) {
    return TRUNCATION_MARKER.slice(0, boundedLength);
  }
  return `${output.slice(0, boundedLength - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

const HIGH_RISK_CONTEXT_KEYS = new Set([
  "body",
  "headers",
  "input",
  "output",
  "payload",
  "prompt",
  "props",
  "raw",
  "requestbody",
  "responsebody",
  "stack",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPathKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return normalized === "path" || normalized === "file" || normalized === "directory" ||
    normalized === "dir" || normalized.endsWith("path") || normalized.endsWith("file") ||
    normalized.endsWith("directory");
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) ||
    /^\\\\(?:[?.]\\|[^\\/\s"'`<>]+\\)/.test(value);
}

/**
 * Sanitize arbitrary diagnostic text before it crosses a log or response boundary.
 */
export function sanitizeErrorText(
  input: string,
  maxLength = DEFAULT_MAX_TEXT_LENGTH,
): string {
  if (typeof input !== "string") return "";

  const requestedLength = Number.isSafeInteger(maxLength) && maxLength > 0
    ? maxLength
    : DEFAULT_MAX_TEXT_LENGTH;
  const boundedLength = Math.min(requestedLength, MAX_SANITIZED_TEXT_LENGTH);
  const sourceLength = Math.min(
    input.length,
    boundedLength + SANITIZATION_LOOKAHEAD_LENGTH,
  );
  const source = input.slice(0, sourceLength);

  let output = sanitizeUrlCredentials(source);
  output = output.replace(/\bfile:\/\/[^\s"'`<>),;}]+/gi, LOCAL_PATH);
  output = output.replace(
    /(^|[\s("'=:[{])\\\\(?:[?.]\\|[^\\/\s"'`<>),;}]+\\)[^\s"'`<>),;}]+/g,
    (_match, prefix: string) => `${prefix}${LOCAL_PATH}`,
  );
  output = output.replace(/\b[A-Za-z]:[\\/][^\s"'`<>]+/g, LOCAL_PATH);
  output = output.replace(
    /(^|[\s("'=:[{])~[\\/][^\s"'`<>),;}]+/g,
    (_match, prefix: string) => `${prefix}${LOCAL_PATH}`,
  );
  output = output.replace(
    /(^|[\s("'=:[{])\/(?!\/)[^\s"'`<>),;}]+/g,
    (_match, prefix: string) => `${prefix}${LOCAL_PATH}`,
  );
  output = stripUnsafeControlCharacters(output);

  return truncateSanitizedText(output, boundedLength, sourceLength < input.length);
}

/** Return a credential-free RFC 9457 instance URI without query or fragment data. */
export function sanitizeErrorInstance(input: string): string {
  if (typeof input !== "string") return "";
  const source = input.slice(0, 8_192);
  const safeSource = stripUnsafeControlCharacters(source).replace(/[\t\r\n]/g, "");
  const trimmedSource = safeSource.trimStart();
  if (/^file:/i.test(trimmedSource) || isWindowsAbsolutePath(trimmedSource)) {
    return LOCAL_PATH;
  }
  const sanitized = sanitizeUrlForSpan(safeSource);
  return truncateSanitizedText(sanitized, 4_096, source.length < input.length);
}

function sanitizeContextValue(
  value: unknown,
  key: string | undefined,
  depth: number,
  budget: { remaining: number },
): unknown {
  if (budget.remaining-- <= 0 || depth > MAX_CONTEXT_DEPTH) return REDACTED;
  if (key && HIGH_RISK_CONTEXT_KEYS.has(normalizeKey(key))) return REDACTED;
  if (key && isPathKey(key) && typeof value === "string") return LOCAL_PATH;
  if (typeof value === "string") return sanitizeErrorText(value, 16_384);
  if (typeof value === "number") return Number.isFinite(value) ? value : REDACTED;
  if (
    value === null || typeof value === "boolean" || typeof value === "undefined"
  ) return value;
  if (typeof value === "function" || typeof value === "symbol") return REDACTED;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeContextValue(item, undefined, depth + 1, budget));
  }

  if (value && typeof value === "object") {
    const output = Object.create(null) as Record<string, unknown>;
    try {
      for (const [childKey, childValue] of Object.entries(value)) {
        const sanitizedKey = sanitizeErrorText(childKey, 256) || "[REDACTED_KEY]";
        Object.defineProperty(output, sanitizedKey, {
          configurable: true,
          enumerable: true,
          value: sanitizeContextValue(
            childValue,
            childKey,
            depth + 1,
            budget,
          ),
          writable: true,
        });
      }
      return output;
    } catch {
      return REDACTED;
    }
  }

  return value;
}

/**
 * Return a bounded, fail-closed diagnostic-context snapshot.
 */
export function sanitizeErrorContext(
  value: unknown,
): Record<string, unknown> | undefined {
  try {
    const redacted = redactSensitive(value);
    if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) {
      return undefined;
    }
    const sanitized = sanitizeContextValue(
      redacted,
      undefined,
      0,
      { remaining: MAX_CONTEXT_NODES },
    );
    return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
      ? sanitized as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
