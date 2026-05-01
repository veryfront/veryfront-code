import { z } from "zod";
import { dynamicTool, tool } from "./factory.ts";
import type { JsonSchema } from "./schema/json-schema.ts";
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
  inputSchema: z.ZodSchema<unknown>;
  execute: HostToolExecute;
};

export interface HostToolMaterializationOptions {
  generateToolCallId?: (toolName: string) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isZodSchema(value: unknown): value is z.ZodSchema<unknown> {
  if (!isRecord(value) || typeof value.parse !== "function") return false;
  if (!isRecord(value._def)) return false;
  return typeof value._def.typeName === "string" || typeof value._def.type === "string";
}

function isHostToolDefinition(value: unknown): value is RunnableHostToolDefinition {
  return (
    isRecord(value) &&
    typeof value.description === "string" &&
    isZodSchema(value.inputSchema) &&
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
