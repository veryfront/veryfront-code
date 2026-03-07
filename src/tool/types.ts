/****
 * Tool type definitions
 */

import type { z } from "zod";
import type { JsonSchema } from "./schema/json-schema.ts";
import type { BlobStorage } from "#veryfront/workflow/blob/types.ts";

/**
 * Tool configuration options
 */
// deno-lint-ignore no-explicit-any -- generic erasure: interface must accept any concrete ToolConfig instantiation
export interface ToolConfig<TInput = any, TOutput = any> {
  /** Tool identifier (optional, inferred from filename) */
  id?: string;

  /** Tool description for the AI model */
  description: string;

  /** Input schema (Zod schema) */
  inputSchema: z.ZodSchema<TInput>;

  /**
   * Allow unknown/non-Zod schemas to fall back to a permissive JSON schema.
   * Use only for truly dynamic tools; prefer z.unknown() or z.any() instead.
   */
  allowUnknownSchema?: boolean;

  /**
   * Tool execution function
   */
  execute: (input: TInput, context?: ToolExecutionContext) => Promise<TOutput> | TOutput;

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
 * Context passed to tool execution
 */
export interface ToolExecutionContext {
  /** ID of the agent calling the tool (if any) */
  agentId?: string;
  /** Project identity used by integration token resolution */
  projectId?: string;
  /** End-user identity for per-user token resolution in integration tools */
  endUserId?: string;
  /** Additional context */
  [key: string]: unknown;
  /** Blob storage access (if configured in workflow) */
  blobStorage?: BlobStorage;
}

/**
 * Tool type discriminator
 * - 'function': Standard tool with known input/output types (default)
 * - 'dynamic': Dynamic tool with unknown types (MCP tools, user-defined functions)
 */
export type ToolType = "function" | "dynamic";

/**
 * Tool instance (returned by tool() function)
 */
// deno-lint-ignore no-explicit-any -- generic erasure: interface must accept any concrete Tool instantiation
export interface Tool<TInput = any, TOutput = any> {
  /** Tool ID */
  id: string;

  /**
   * Tool type discriminator
   * - 'function': Standard tool with known types (default)
   * - 'dynamic': Dynamic tool for MCP, user-defined functions, etc.
   */
  type: ToolType;

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
  execute: (input: TInput, context?: ToolExecutionContext) => Promise<TOutput>;

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
