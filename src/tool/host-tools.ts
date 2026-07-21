import { dynamicTool, tool } from "./factory.ts";
import { agentLogger } from "#veryfront/utils";
import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import type { Tool, ToolConfig, ToolExecutionContext, ToolSet } from "./types.ts";

type HostToolExecute = {
  bivarianceHack: (input: unknown, options?: ToolExecutionContext) => Promise<unknown> | unknown;
}["bivarianceHack"];

/** Definition for host tool. */
export type HostToolDefinition = {
  id?: string;
  type?: Tool["type"];
  /** Owning agent id retained for owner-aware hosted tool selection. */
  ownerAgentId?: string;
  /** Short selector accepted by the owning agent's `tools:` configuration. */
  shortName?: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  inputSchemaJson?: JsonSchema;
  parameters?: unknown;
  providerOptions?: unknown;
  execute?: Tool["execute"] | HostToolExecute;
  mcp?: ToolConfig["mcp"];
};

/** Public API contract for host tool set. */
export type HostToolSet = Record<string, HostToolDefinition>;

type RunnableHostToolDefinition = HostToolDefinition & {
  description: string;
  inputSchema: unknown;
  execute: HostToolExecute;
};

/** Options accepted by host tool materialization. */
export interface HostToolMaterializationOptions {
  generateToolCallId?: (toolName: string) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Detect a contract `Schema<T>` value produced by defineSchema. */
function isSchemaLike(value: unknown): value is Schema<unknown> {
  if (!isRecord(value)) return false;
  if (typeof value.parse !== "function") return false;
  // Contract Schema<T> brand from the ext-schema-zod adapter.
  if ("__zod" in value) return true;
  // defineSchema wrapper without a brand yet — match on the contract surface.
  return "_output" in value && typeof value.safeParse === "function";
}

function isParserBackedPrecomputedSchema(input: {
  inputSchema?: unknown;
  inputSchemaJson?: unknown;
}): boolean {
  return (
    isRecord(input.inputSchema) &&
    typeof input.inputSchema.parse === "function" &&
    isRecord(input.inputSchemaJson)
  );
}

function isHostToolDefinition(value: unknown): value is RunnableHostToolDefinition {
  return (
    isRecord(value) &&
    typeof value.description === "string" &&
    (isSchemaLike(value.inputSchema) || isParserBackedPrecomputedSchema(value)) &&
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

/** Create tools from host definitions. */
export function createToolsFromHostDefinitions(
  definitions: HostToolSet,
  options?: HostToolMaterializationOptions,
): ToolSet;
/** Create tools from host definitions. */
export function createToolsFromHostDefinitions(
  definitions: Record<string, unknown>,
  options?: HostToolMaterializationOptions,
): ToolSet;
/** Create tools from host definitions. */
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
      if (definition.inputSchemaJson) {
        tools[toolName] = dynamicTool({
          id: toolName,
          description: definition.description,
          inputSchema: definition.inputSchema,
          inputSchemaJson: definition.inputSchemaJson,
          execute,
          mcp: definition.mcp,
        });
      } else if (isSchemaLike(definition.inputSchema)) {
        tools[toolName] = tool({
          id: toolName,
          description: definition.description,
          inputSchema: definition.inputSchema,
          execute,
          mcp: definition.mcp,
        });
      }
    } catch (error) {
      agentLogger.warn("Skipping host tool: schema conversion failed", {
        toolName,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      continue;
    }
  }

  return tools;
}
