
import type { z } from "zod";
import type { JsonSchema } from "./json-schema.ts";

export interface ToolConfig<TInput = any, TOutput = any> {
  id?: string;

  description: string;

  inputSchema: z.ZodSchema<TInput>;

  execute: (
    input: TInput,
    context?: ToolExecutionContext,
  ) => Promise<TOutput> | TOutput;

  mcp?: {
    enabled?: boolean;

    requiresAuth?: boolean;

    cachePolicy?: "no-cache" | "cache" | "cache-first";
  };
}

import type { BlobStorage } from "../workflow/blob/types.ts";

export interface ToolExecutionContext {
  agentId?: string;
  [key: string]: unknown;
  blobStorage?: BlobStorage;
}

export interface Tool<TInput = any, TOutput = any> {
  id: string;

  description: string;

  inputSchema: z.ZodSchema<TInput>;

  inputSchemaJson?: JsonSchema;

  execute: (
    input: TInput,
    context?: ToolExecutionContext,
  ) => Promise<TOutput>;

  mcp?: ToolConfig["mcp"];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolRegistryEntry {
  id: string;

  tool: Tool;

  filePath?: string;

  autoDiscovered: boolean;
}
