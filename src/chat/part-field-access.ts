/**
 * Reading fields off untrusted `unknown` values.
 *
 * The single owner of turning an unvalidated value into a typed field, so chat
 * parsing never hand-rolls its own record/string checks. Dependency-free apart
 * from JSON stringification: no chat, tool, or schema knowledge belongs here.
 */
import { type ChatJsonValue, stringifyChatJson, toChatJsonValue } from "./json-value.ts";

/** JSON-compatible value. Re-exported from `json-value.ts` so both agree by construction. */
export type JsonValue = ChatJsonValue;

/** Check whether a value is a non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return string field. */
export function getStringField(value: unknown, field: string, fallback: string): string {
  if (!isRecord(value) || typeof value[field] !== "string") {
    return fallback;
  }

  return value[field];
}

/** Return a string field when present, else undefined. */
export function getOptionalStringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

/** Return a non-empty string field when present, else undefined. */
export function getNonEmptyStringField(value: unknown, key: string): string | undefined {
  const field = getOptionalStringField(value, key);
  return field && field.length > 0 ? field : undefined;
}

/** Shallow-copy a value into a plain record, or an empty record. */
export function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? Object.fromEntries(Object.entries(value)) : {};
}

/** Stringify unknown helper. */
export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "bigint" ||
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return String(value);
  }
  return stringifyChatJson(value);
}

/** Convert a value into a JSON-safe value. */
export function toJsonValue(value: unknown): JsonValue {
  return toChatJsonValue(value);
}
