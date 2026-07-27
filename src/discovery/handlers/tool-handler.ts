/**
 * Tool Discovery Handler
 */

import type { Tool } from "#veryfront/tool";
import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import { registerTool } from "#veryfront/mcp";
import { assertSchemaContract } from "#veryfront/schemas/define.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId } from "../discovery-utils.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isContractSchema(value: unknown): boolean {
  try {
    assertSchemaContract(value, "Expected a schema contract");
    return true;
  } catch {
    return false;
  }
}

const JSON_SCHEMA_PRIMITIVE_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

function isJsonSchemaType(value: unknown): boolean {
  if (typeof value === "string") return JSON_SCHEMA_PRIMITIVE_TYPES.has(value);
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && JSON_SCHEMA_PRIMITIVE_TYPES.has(item));
}

/**
 * JSON Schema allows an empty object and schemas composed solely from
 * keywords such as `anyOf`, so `type` cannot be required. Contract schemas
 * are excluded to keep normalization from copying validator internals into
 * the provider-facing `inputSchemaJson` field.
 */
function snapshotJsonSchema(value: unknown): JsonSchema | undefined {
  if (isContractSchema(value)) return undefined;
  const snapshot = snapshotBoundedJsonValue(value);
  if (
    !snapshot.success ||
    !isRecord(snapshot.value) ||
    (snapshot.value.type !== undefined && !isJsonSchemaType(snapshot.value.type))
  ) {
    return undefined;
  }
  return snapshot.value;
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return snapshotJsonSchema(value) !== undefined;
}

/** Whether a module export carries the complete contract discovery consumes. */
export function isDiscoverableTool(item: unknown): item is Tool {
  if (!isRecord(item)) return false;

  const hasValidId = item.id === undefined ||
    (typeof item.id === "string" && item.id.trim().length > 0);
  const hasUsableSchema = isContractSchema(item.inputSchema) ||
    isJsonSchema(item.inputSchema);

  return hasValidId &&
    (item.type === "function" || item.type === "dynamic") &&
    typeof item.description === "string" &&
    item.description.trim().length > 0 &&
    hasUsableSchema &&
    (item.inputSchemaJson === undefined || isJsonSchema(item.inputSchemaJson)) &&
    typeof item.execute === "function";
}

/**
 * Converts literal JSON-schema tools to the same provider-facing shape as
 * tools created by `tool()`. Contract schemas remain opaque.
 */
export function prepareDiscoveredTool(tool: Tool, id: string): Tool {
  const withId = tool.id === id ? tool : { ...tool, id };
  if (withId.inputSchemaJson !== undefined) {
    const inputSchemaJson = snapshotJsonSchema(withId.inputSchemaJson);
    if (!inputSchemaJson) {
      throw new TypeError("Discovered tool inputSchemaJson must be a bounded JSON Schema object");
    }
    return {
      ...withId,
      // Detach registry state from later project-code mutation.
      inputSchemaJson,
    };
  }
  const literalSchema = snapshotJsonSchema(withId.inputSchema);
  if (!literalSchema) {
    if (!isContractSchema(withId.inputSchema)) {
      throw new TypeError(
        "Discovered tool inputSchema must implement the schema contract or be bounded JSON Schema",
      );
    }
    return withId;
  }
  return {
    ...withId,
    inputSchemaJson: literalSchema,
  };
}

function hasGeneratedToolId(tool: Tool): boolean {
  return typeof tool.__veryfrontGeneratedId === "string" &&
    tool.id === tool.__veryfrontGeneratedId;
}

export const toolHandler: DiscoveryHandler<Tool> = {
  typeName: "tool",
  validate: isDiscoverableTool,
  getId: (tool, file) => {
    return typeof tool.id === "string" &&
        tool.id.trim().length > 0 &&
        !hasGeneratedToolId(tool)
      ? tool.id
      : filenameToId(file);
  },
  register: (id, tool) => {
    const toolWithId = prepareDiscoveredTool(tool, id);
    registerTool(id, toolWithId);
    return toolWithId;
  },
  getResultMap: (result) => result.tools,
};
