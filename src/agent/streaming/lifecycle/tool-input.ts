import { privateJsonParse } from "#veryfront/security/private-json.ts";
import { stripLeadingEmptyObjectPlaceholder } from "#veryfront/agent/streaming/data-stream.ts";

const isArray = Array.isArray;

export type CanonicalToolInputParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: "invalid" | "malformed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !isArray(value);
}

export function parseCanonicalToolInput(
  input: unknown,
): CanonicalToolInputParseResult {
  if (isRecord(input)) return { ok: true, value: input };
  if (typeof input !== "string") return { ok: false, reason: "invalid" };

  const normalized = stripLeadingEmptyObjectPlaceholder(input);
  if (normalized.length === 0) return { ok: false, reason: "invalid" };
  try {
    const parsed: unknown = privateJsonParse(normalized);
    return isRecord(parsed) ? { ok: true, value: parsed } : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
