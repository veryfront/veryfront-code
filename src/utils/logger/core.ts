/**
 * Shared logger formatting utilities.
 * This module contains pure formatting functions with no external dependencies,
 * enabling reuse between the main logger and proxy logger.
 *
 * @module
 */

// ============================================================================
// Constants
// ============================================================================

export const TAG_WIDTH = 10;
export const PREFIX_WIDTH = 23; // timestamp(8) + gap(2) + tag(10) + space(1) + glyph(1) + space(1)

export type LogLevelName = "debug" | "info" | "warn" | "error";

export const LEVEL_GLYPHS: Record<LogLevelName, string> = {
  debug: "·",
  info: "●",
  warn: "▲",
  error: "✖",
};

export const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  gray: "\u001b[90m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
} as const;

export const LEVEL_COLORS: Record<LogLevelName, string> = {
  debug: ANSI.gray,
  info: ANSI.green,
  warn: ANSI.yellow,
  error: ANSI.red,
};

// ============================================================================
// Pure Formatting Functions (no dependencies)
// ============================================================================

function consumeControlSequence(value: string, start: number, kind: "csi" | "osc"): number {
  if (kind === "csi") {
    for (let index = start; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return index + 1;
    }
    return value.length;
  }

  for (let index = start; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0x07 || code === 0x9c) return index + 1;
    if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
  }
  return value.length;
}

/**
 * Neutralize terminal control sequences and line-breaking control characters
 * in untrusted log text before framework-owned ANSI styling is applied.
 */
export function sanitizeLogText(value: string): string {
  let sanitized = "";

  for (let index = 0; index < value.length;) {
    const code = value.charCodeAt(index);

    if (code === 0x1b) {
      const next = value.charCodeAt(index + 1);
      if (next === 0x5b) {
        index = consumeControlSequence(value, index + 2, "csi");
      } else if (next === 0x5d) {
        index = consumeControlSequence(value, index + 2, "osc");
      } else {
        index += Number.isNaN(next) ? 1 : 2;
      }
      continue;
    }
    if (code === 0x9b) {
      index = consumeControlSequence(value, index + 1, "csi");
      continue;
    }
    if (code === 0x9d) {
      index = consumeControlSequence(value, index + 1, "osc");
      continue;
    }

    if (
      (code >= 0x09 && code <= 0x0d) ||
      code === 0x85 ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      if (!sanitized.endsWith(" ")) sanitized += " ";
      index++;
      continue;
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      index++;
      continue;
    }

    sanitized += value[index];
    index++;
  }

  return sanitized;
}

/**
 * Pad or truncate a tag to fixed width for aligned output.
 */
export function padTag(tag: string): string {
  if (tag.length >= TAG_WIDTH) return tag.slice(0, TAG_WIDTH);
  return tag.padEnd(TAG_WIDTH, " ");
}

/**
 * Format a timestamp as HH:MM:SS.
 */
export function formatTimestamp(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Apply ANSI color codes to text if enabled.
 */
export function colorize(text: string, color: string | undefined, enable: boolean): string {
  if (!enable || !color) return text;
  return `${color}${text}${ANSI.reset}`;
}

/**
 * Normalize whitespace in text (collapse multiple spaces to single space).
 */
export function normalizeText(value: string): string {
  return sanitizeLogText(value).replace(/\s+/g, " ");
}

/**
 * Truncate text to maxLength, adding ellipsis if truncated.
 */
export function truncateText(value: string, maxLength = 80): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

/**
 * Format a value for log output (handles strings, numbers, booleans, objects).
 */
export function formatValue(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = normalizeText(value);
    return /\s/.test(trimmed) ? JSON.stringify(trimmed) : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (_) {
    /* expected: JSON.stringify fails on circular references */
    text = String(value);
  }

  // JSON.stringify can return undefined for certain values (e.g., functions, symbols)
  if (text === undefined) return "undefined";
  return truncateText(normalizeText(text));
}

/**
 * Serialized error structure for structured logging.
 */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * Format a serialized error for text output.
 */
export function formatErrorText(error: SerializedError | undefined): string {
  if (!error) return "";
  const text = `${error.name}: ${error.message}`;
  return truncateText(normalizeText(text), 120);
}

/**
 * Serialize an error object for structured logging.
 */
export function serializeError(error: unknown): SerializedError | undefined {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (error == null) return undefined;
  return { name: "UnknownError", message: String(error) };
}

/**
 * Format context and error as indented key=value pairs.
 * Filters out undefined values for cleaner output.
 */
export function formatContextText(
  context: Record<string, unknown>,
  error: SerializedError | undefined,
  enableColor: boolean,
): string {
  const entries = Object.entries(context)
    .filter(([_, value]) => value !== undefined)
    .map(([key, value]) => `${normalizeText(key)}=${formatValue(value)}`);
  if (error) entries.push(`err=${formatErrorText(error)}`);
  if (entries.length === 0) return "";

  const indent = " ".repeat(PREFIX_WIDTH);
  return `\n${indent}${colorize(entries.join(" "), ANSI.dim, enableColor)}`;
}

/**
 * Check if value is a non-null, non-array object (plain record).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
