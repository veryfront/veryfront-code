import { z } from "zod";
import { dynamicTool, tool } from "./factory.ts";
import type { JsonSchema } from "./schema/json-schema.ts";
import type { Tool, ToolConfig, ToolExecutionContext } from "./types.ts";

export interface HostToolDefinition {
  description: string;
  inputSchema: z.ZodSchema<unknown>;
  inputSchemaJson?: JsonSchema;
  execute: (input: unknown, context: ToolExecutionContext) => Promise<unknown> | unknown;
  mcp?: ToolConfig["mcp"];
}

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

function isHostToolDefinition(value: unknown): value is HostToolDefinition {
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
  definitions: Record<string, unknown>,
  options: HostToolMaterializationOptions = {},
): Record<string, Tool<unknown, unknown>> {
  const tools: Record<string, Tool<unknown, unknown>> = {};

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
