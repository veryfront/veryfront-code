import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { Tool } from "#veryfront/tool/types.ts";
import type { Resource } from "#veryfront/resource/types.ts";
import type { Prompt } from "#veryfront/prompt/types.ts";
export type { ToolAnnotations } from "./annotations.ts";
import type { ToolAnnotations } from "./annotations.ts";

/**
 * Generic MCP tool definition
 */
// deno-lint-ignore no-explicit-any -- generic erasure: interface must accept any concrete Tool instantiation
export interface MCPTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  inputSchema: Schema<TInput>;
  execute: (input: TInput) => Promise<TOutput>;
  title?: string;
  annotations?: ToolAnnotations;
}

/**
 * Wire format for a single tool in a tools/list response.
 */
export interface ToolListEntry {
  name: string;
  description: string;
  inputSchema: unknown;
  title?: string;
  annotations?: ToolAnnotations;
}

export interface MCPRegistry {
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
}

// Re-export schema-based types
export type { MCPServerConfig, MCPStats } from "./schemas/index.ts";
