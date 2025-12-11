import type { Tool, ToolConfig, ToolDefinition, ToolExecutionContext } from "../types/tool.ts";
import type { JsonSchema } from "../types/json-schema.ts";
import { zodToJsonSchema } from "./zod-json-schema.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

export function tool<TInput = any, TOutput = any>(
  config: ToolConfig<TInput, TOutput>,
): Tool<TInput, TOutput> {
  const id = config.id || generateToolId();

  const hasValidZodSchema = config.inputSchema &&
    typeof config.inputSchema === "object" &&
    "_def" in config.inputSchema &&
    (config.inputSchema as { _def?: { typeName?: string } })._def?.typeName;

  let inputSchemaJson: JsonSchema | undefined;
  if (hasValidZodSchema) {
    try {
      inputSchemaJson = zodToJsonSchema(config.inputSchema);
      agentLogger.info(
        `[TOOL] Pre-converted schema for "${id}": ${
          Object.keys(inputSchemaJson.properties || {}).length
        } properties`,
      );
    } catch (error) {
      agentLogger.warn(`[TOOL] Failed to pre-convert schema for "${id}":`, error);
    }
  } else {
    const externalSchema = config.inputSchema as {
      _def?: {
        typeName?: string;
        shape?: (() => Record<string, unknown>) | Record<string, unknown>;
      };
    };

    if (externalSchema?._def?.shape) {
      try {
        const shape = typeof externalSchema._def.shape === "function"
          ? externalSchema._def.shape()
          : externalSchema._def.shape;

        const properties: Record<string, JsonSchema> = {};
        for (const key of Object.keys(shape || {})) {
          properties[key] = { type: "string" as const };
        }
        inputSchemaJson = {
          type: "object" as const,
          properties,
          required: Object.keys(properties),
        };
        agentLogger.info(
          `[TOOL] Introspected schema for "${id}" from external zod: ${
            Object.keys(properties).length
          } properties`,
        );
      } catch {
        inputSchemaJson = { type: "object", properties: {} };
        agentLogger.warn(
          `[TOOL] Schema for "${id}" could not be introspected. Using empty schema.`,
        );
      }
    } else {
      agentLogger.warn(
        `[TOOL] Schema for "${id}" is not a valid Zod schema (different zod instance?). ` +
          `Skipping pre-conversion. Input validation may be limited.`,
      );
      inputSchemaJson = { type: "object", properties: {} };
    }
  }

  return {
    id,
    description: config.description,
    inputSchema: config.inputSchema,
    inputSchemaJson,
    execute: async (input: TInput, context?: ToolExecutionContext) => {
      if (hasValidZodSchema) {
        try {
          config.inputSchema.parse(input);
        } catch (error) {
          throw toError(createError({
            type: "agent",
            message: `Tool "${id}" input validation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          }));
        }
      } else if (
        config.inputSchema &&
        typeof config.inputSchema === "object" &&
        "parse" in config.inputSchema &&
        typeof (config.inputSchema as { parse?: unknown }).parse === "function"
      ) {
        try {
          (config.inputSchema as { parse: (input: unknown) => void }).parse(input);
        } catch (error) {
          throw toError(createError({
            type: "agent",
            message: `Tool "${id}" input validation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          }));
        }
      }

      return await config.execute(input, context);
    },
    mcp: config.mcp,
  };
}

let toolIdCounter = 0;
function generateToolId(): string {
  return `tool_${Date.now()}_${toolIdCounter++}`;
}

class ToolRegistryClass {
  private tools = new Map<string, Tool>();

  register(id: string, toolInstance: Tool): void {
    if (this.tools.has(id)) {
      agentLogger.debug(`Tool "${id}" is already registered. Overwriting.`);
    }

    this.tools.set(id, toolInstance);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  getAllIds(): string[] {
    return Array.from(this.tools.keys());
  }

  getAll(): Map<string, Tool> {
    return new Map(this.tools);
  }

  clear(): void {
    this.tools.clear();
  }

  getToolsForProvider(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(toolToProviderDefinition);
  }
}

const TOOL_REGISTRY_KEY = "__veryfront_tool_registry__";
// deno-lint-ignore no-explicit-any
const _globalTool = globalThis as any;
export const toolRegistry: ToolRegistryClass = _globalTool[TOOL_REGISTRY_KEY] ||=
  new ToolRegistryClass();

export function toolToProviderDefinition(tool: Tool): ToolDefinition {
  const jsonSchema = tool.inputSchemaJson || zodToJsonSchema(tool.inputSchema);

  agentLogger.info(
    `[TOOL] Using ${
      tool.inputSchemaJson ? "pre-converted" : "runtime-converted"
    } schema for "${tool.id}"`,
  );

  return {
    name: tool.id,
    description: tool.description,
    parameters: jsonSchema,
  };
}

export async function executeTool(
  toolId: string,
  input: unknown,
  context?: ToolExecutionContext,
): Promise<unknown> {
  const tool = toolRegistry.get(toolId);

  if (!tool) {
    throw toError(createError({
      type: "agent",
      message: `Tool "${toolId}" not found`,
    }));
  }

  try {
    const result = await tool.execute(input, context);
    return result;
  } catch (error) {
    throw toError(createError({
      type: "agent",
      message: `Tool "${toolId}" execution failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }));
  }
}

export { zodToJsonSchema } from "./zod-json-schema.ts";
