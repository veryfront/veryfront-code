import type { z } from "zod";
import type { Tool } from "#veryfront/tool";
import type { Resource } from "#veryfront/resource";
import type { Prompt } from "#veryfront/prompt";

/**
 * Generic MCP tool definition
 */
// deno-lint-ignore no-explicit-any -- generic erasure: interface must accept any concrete Tool instantiation
export interface MCPTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  // deno-lint-ignore no-explicit-any -- ZodType Def/Input params require any for ZodDefault/ZodOptional compatibility
  inputSchema: z.ZodType<TInput, any, any>;
  execute: (input: TInput) => Promise<TOutput>;
}

export interface MCPRegistry {
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
}

// Re-export schema-based types
export type { MCPServerConfig, MCPStats } from "./schemas/index.ts";
