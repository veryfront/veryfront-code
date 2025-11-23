/**
 * Tool type definitions
 */

import type { z } from "zod";
import type { JsonSchema } from "./json-schema.ts";

/**
 * Tool configuration options
 */
export interface ToolConfig<TInput = any, TOutput = any> {
  /** Tool identifier (optional, inferred from filename) */
  id?: string;

  /** Tool description for the AI model */
  description: string;

  /** Input schema (Zod schema) */
  inputSchema: z.ZodSchema<TInput>;

  /**
   * Tool execution function
   */
  execute: (
    input: TInput,
    context?: ToolExecutionContext,
  ) => Promise<TOutput> | TOutput;

  /** MCP configuration */
  mcp?: {
    /** Expose via MCP */
    enabled?: boolean;

    /** Require authentication */
    requiresAuth?: boolean;

    /** Cache policy */
    cachePolicy?: "no-cache" | "cache" | "cache-first";
  };
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  /** Agent ID calling the tool */
  agentId?: string;

  /** Request metadata */
  metadata?: Record<string, unknown>;

  /** Platform-specific environment (e.g., CF Workers env) */
  env?: Record<string, unknown>;
}

/**
 * Tool instance (returned by tool() function)
 */
export interface Tool<TInput = any, TOutput = any> {
  /** Tool ID */
  id: string;

  /** Tool description */
  description: string;

  /** Input schema (Zod) */
  inputSchema: z.ZodSchema<TInput>;

  /**
   * Pre-converted JSON Schema (for OpenAI/provider compatibility)
   * This is generated at tool creation time to avoid bundling issues
   */
  inputSchemaJson?: JsonSchema;

  /**
   * Execute the tool
   */
  execute: (
    input: TInput,
    context?: ToolExecutionContext,
  ) => Promise<TOutput>;

  /** MCP configuration */
  mcp?: ToolConfig["mcp"];
}

/**
 * Provider-facing tool definition used for model/tool registration.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/**
 * Tool registry entry
 */
export interface ToolRegistryEntry {
  /** Tool ID */
  id: string;

  /** Tool instance */
  tool: Tool;

  /** File path where tool was defined */
  filePath?: string;

  /** Auto-discovered */
  autoDiscovered: boolean;
}
