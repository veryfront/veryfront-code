import type { Tool } from "#veryfront/tool/types.ts";
import type { Resource } from "#veryfront/resource/types.ts";
import type { Prompt } from "#veryfront/prompt/types.ts";
export type { ToolAnnotations } from "./annotations.ts";
import type { ToolAnnotations } from "./annotations.ts";

/** Minimal schema contract required by an MCP tool definition. */
export interface MCPInputSchema<T> {
  /** Validate unknown input and return its typed representation. */
  parse(value: unknown): T;
}

/** Parameters accepted by an MCP JSON-RPC method. */
export type JSONRPCParams = Record<string, unknown> | unknown[];

/** Request-scoped context accepted by MCP tool and prompt operations. */
export interface MCPRequestContext {
  /** Validated project identifier supplied by the HTTP transport. */
  projectId?: string;
  /** Cooperative cancellation for the current request. */
  abortSignal?: AbortSignal;
  /** Client progress token forwarded to tool execution. */
  progressToken?: string | number;
  /** Additional trusted host context for in-process callers. */
  [key: string]: unknown;
}

/**
 * Generic MCP tool definition
 */
// deno-lint-ignore no-explicit-any -- generic erasure: interface must accept any concrete Tool instantiation
export interface MCPTool<TInput = any, TOutput = any> {
  /** Stable tool identifier exposed to MCP clients. */
  name: string;
  /** User-facing summary of the tool behavior. */
  description: string;
  /** Schema used to validate tool arguments before execution. */
  inputSchema: MCPInputSchema<TInput>;
  /** Execute the tool with validated input. */
  execute: (input: TInput) => Promise<TOutput>;
  /** Optional user-facing display title. */
  title?: string;
  /** Behavioral hints used by MCP clients. */
  annotations?: ToolAnnotations;
}

/**
 * Wire format for a single tool in a tools/list response.
 */
export interface ToolListEntry {
  /** Stable tool identifier. */
  name: string;
  /** Human-readable tool behavior. */
  description: string;
  /** JSON Schema accepted by the tool. */
  inputSchema: unknown;
  /** JSON Schema produced by the tool, when declared. */
  outputSchema?: unknown;
  /** Optional display title. */
  title?: string;
  /** Behavioral hints for clients. */
  annotations?: ToolAnnotations;
  /** Execution modes supported by the tool. */
  execution?: {
    /** Whether calls can use MCP task-augmented execution. */
    taskSupport: "forbidden" | "optional" | "required";
  };
}

export interface MCPRegistry {
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
}

// Re-export schema-based types
export type { MCPAuthConfig, MCPServerConfig, MCPStats } from "./schemas/index.ts";
