import type { z } from "zod";
import type { Tool } from "#veryfront/tool";
import type { Resource } from "#veryfront/resource";
import type { Prompt } from "#veryfront/prompt";

/**
 * Generic MCP tool definition
 */
// deno-lint-ignore no-explicit-any
export interface MCPTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  // Using ZodType with output type for compatibility with ZodDefault/ZodOptional
  // deno-lint-ignore no-explicit-any
  inputSchema: z.ZodType<TInput, any, any>;
  execute: (input: TInput) => Promise<TOutput>;
}

export interface MCPRegistry {
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
}

export interface MCPServerConfig {
  enabled: boolean;
  port?: number;
  auth?: {
    type: "bearer" | "api-key" | "none";
    validate?: (token: string) => Promise<boolean> | boolean;
  };
  cors?: {
    enabled: boolean;
    origins?: string[];
  };
}

export interface MCPStats {
  tools: number;
  resources: number;
  prompts: number;
  total: number;
}
