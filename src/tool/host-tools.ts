import { dynamicTool, tool } from "./factory.ts";
import type { JsonSchema, Schema } from "#veryfront/extensions/interfaces/index.ts";
import type { Tool, ToolConfig, ToolExecutionContext, ToolSet } from "./types.ts";

type HostToolExecute = {
  bivarianceHack: (input: unknown, options?: ToolExecutionContext) => Promise<unknown> | unknown;
}["bivarianceHack"];

export type HostToolDefinition = {
  id?: string;
  type?: Tool["type"];
  title?: string;
  description?: string;
  inputSchema?: unknown;
  inputSchemaJson?: JsonSchema;
  parameters?: unknown;
  providerOptions?: unknown;
  execute?: Tool["execute"] | HostToolExecute;
  mcp?: ToolConfig["mcp"];
};

export type HostToolSet = Record<string, HostToolDefinition>;

type RunnableHostToolDefinition = HostToolDefinition & {
  description: string;
  inputSchema: Schema<unknown>;
  execute: HostToolExecute;
};

export interface HostToolMaterializationOptions {
  generateToolCallId?: (toolName: string) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Detect a contract `Schema<T>` (defineSchema-produced wrapper) or a raw
 * zod schema. Both are accepted during the migration window so host tools
 * can feed either into the framework without bespoke conversion.
 */
function isSchemaLike(value: unknown): value is Schema<unknown> {
  if (!isRecord(value)) return false;
  if (typeof value.parse !== "function") return false;
  // Contract Schema<T> brand from the ext-zod adapter.
  if ("__zod" in value) return true;
  // defineSchema wrapper without a brand yet — match on the contract surface.
  if ("_output" in value && typeof value.safeParse === "function") return true;
  // Raw zod schema (legacy host paths still hand us bare zod instances).
  if (!isRecord(value._def)) return false;
  return typeof value._def.typeName === "string" || typeof value._def.type === "string";
}

function isHostToolDefinition(value: unknown): value is RunnableHostToolDefinition {
  return (
    isRecord(value) &&
    typeof value.description === "string" &&
    isSchemaLike(value.inputSchema) &&
    typeof value.execute === "function"
  );
}

function defaultToolCallId(toolName: string): string {
  return `${toolName}-${crypto.randomUUID()}`;
}

function normalizeExecutionContext(
  toolName: string,
  context: ToolExecutionContext | undefined,
  options: HostToolMaterializationOptions,
): ToolExecutionContext {
  const toolCallId = typeof context?.toolCallId === "string" && context.toolCallId.length > 0
    ? context.toolCallId
    : (options.generateToolCallId ?? defaultToolCallId)(toolName);

  return {
    ...(isRecord(context) ? context : {}),
    toolCallId,
  };
}

export function createToolsFromHostDefinitions(
  definitions: HostToolSet,
  options?: HostToolMaterializationOptions,
): ToolSet;
export function createToolsFromHostDefinitions(
  definitions: Record<string, unknown>,
  options?: HostToolMaterializationOptions,
): ToolSet;
export function createToolsFromHostDefinitions(
  definitions: Record<string, unknown>,
  options: HostToolMaterializationOptions = {},
): ToolSet {
  const tools: ToolSet = {};

  for (const [toolName, definition] of Object.entries(definitions)) {
    if (!isHostToolDefinition(definition)) continue;

    const execute = async (input: unknown, context: ToolExecutionContext | undefined) =>
      await definition.execute(input, normalizeExecutionContext(toolName, context, options));

    try {
      tools[toolName] = definition.inputSchemaJson
        ? dynamicTool({
          id: toolName,
          description: definition.description,
          inputSchema: definition.inputSchema,
          inputSchemaJson: definition.inputSchemaJson,
          execute,
          mcp: definition.mcp,
        })
        : tool({
          id: toolName,
          description: definition.description,
          inputSchema: definition.inputSchema,
          execute,
          mcp: definition.mcp,
        });
    } catch {
      continue;
    }
  }

  return tools;
}
