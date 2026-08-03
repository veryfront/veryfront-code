import type { ToolAnnotations } from "#veryfront/mcp/annotations.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { ToolConfig } from "./types.ts";
import { getEnumerableOwnStringDataEntries } from "./data-properties.ts";

const TOOL_MCP_FIELDS = new Set([
  "enabled",
  "requiresAuth",
  "cachePolicy",
  "title",
  "annotations",
]);
const TOOL_ANNOTATION_FIELDS = new Set([
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
]);
const MAX_TOOL_MCP_TITLE_LENGTH = 1_024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate a data-only MCP tool annotations snapshot. */
export function isToolAnnotations(value: unknown): value is ToolAnnotations {
  if (!isRecord(value)) return false;
  let entries: Array<[string, unknown]>;
  try {
    entries = getEnumerableOwnStringDataEntries(value, "Tool MCP annotations");
  } catch {
    return false;
  }
  for (const [key, entry] of entries) {
    if (!TOOL_ANNOTATION_FIELDS.has(key)) return false;
    if (typeof entry !== "boolean") return false;
  }
  return true;
}

/** Snapshot and validate local tool MCP metadata at its construction boundary. */
export function snapshotToolMcpConfig(
  value: ToolConfig["mcp"] | undefined,
  toolId: string,
): ToolConfig["mcp"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new TypeError(
      `Tool "${toolId}" MCP configuration must be a bounded JSON object`,
    );
  }

  const canonicalInput: Record<string, unknown> = {};
  let entries: Array<[string, unknown]>;
  try {
    entries = getEnumerableOwnStringDataEntries(
      value,
      `Tool "${toolId}" MCP configuration`,
    );
  } catch {
    throw new TypeError(
      `Tool "${toolId}" MCP configuration must be a bounded JSON object`,
    );
  }
  for (const [key, entry] of entries) {
    if (!TOOL_MCP_FIELDS.has(key)) {
      throw new TypeError(
        `Tool "${toolId}" MCP configuration contains unsupported field "${key}"`,
      );
    }
    if (entry !== undefined) canonicalInput[key] = entry;
  }

  const snapshot = snapshotBoundedJsonValue(canonicalInput);
  if (!snapshot.success || !isRecord(snapshot.value)) {
    throw new TypeError(
      `Tool "${toolId}" MCP configuration must be a bounded JSON object`,
    );
  }

  const metadata = snapshot.value;
  if (metadata.enabled !== undefined && typeof metadata.enabled !== "boolean") {
    throw new TypeError(`Tool "${toolId}" MCP enabled must be a boolean`);
  }
  if (
    metadata.requiresAuth !== undefined &&
    typeof metadata.requiresAuth !== "boolean"
  ) {
    throw new TypeError(`Tool "${toolId}" MCP requiresAuth must be a boolean`);
  }
  if (
    metadata.cachePolicy !== undefined &&
    metadata.cachePolicy !== "no-cache" &&
    metadata.cachePolicy !== "cache" &&
    metadata.cachePolicy !== "cache-first"
  ) {
    throw new TypeError(`Tool "${toolId}" MCP cachePolicy is invalid`);
  }
  if (
    metadata.title !== undefined &&
    (
      typeof metadata.title !== "string" ||
      metadata.title.length === 0 ||
      metadata.title.length > MAX_TOOL_MCP_TITLE_LENGTH
    )
  ) {
    throw new TypeError(
      `Tool "${toolId}" MCP title must be a non-empty string no longer than ${MAX_TOOL_MCP_TITLE_LENGTH} characters`,
    );
  }
  if (
    metadata.annotations !== undefined &&
    !isToolAnnotations(metadata.annotations)
  ) {
    throw new TypeError(`Tool "${toolId}" MCP annotations are invalid`);
  }

  return metadata as ToolConfig["mcp"];
}
