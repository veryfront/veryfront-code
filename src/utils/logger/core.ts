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
  return value.replace(/\s+/g, " ");
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
  } catch {
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
    .map(([key, value]) => `${key}=${formatValue(value)}`);
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
