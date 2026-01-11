/**
 * MCP (Model Context Protocol) type definitions
 */

import type { z } from "zod";

/**
 * MCP resource configuration
 */
export interface ResourceConfig<TParams = unknown, TData = unknown> {
  /** Resource path pattern (e.g., "/users/:userId/profile") */
  pattern?: string;

  /** Resource description */
  description: string;

  /** Parameters schema */
  paramsSchema: z.ZodSchema<TParams>;

  /**
   * Load resource data
   */
  load: (params: TParams) => Promise<TData> | TData;

  /**
   * Subscribe to resource updates (optional)
   */
  subscribe?: (params: TParams) => AsyncIterable<TData>;

  /** MCP configuration */
  mcp?: {
    /** Expose via MCP */
    enabled?: boolean;

    /** Cache policy */
    cachePolicy?: "no-cache" | "cache" | "cache-first";
  };
}

/**
 * MCP resource instance
 */
export interface Resource<TParams = unknown, TData = unknown> {
  /** Resource ID */
  id: string;

  /** Resource path pattern */
  pattern: string;

  /** Resource description */
  description: string;

  /** Parameters schema */
  paramsSchema: z.ZodSchema<TParams>;

  /**
   * Load resource data
   */
  load: (params: TParams) => Promise<TData>;

  /**
   * Subscribe to updates
   */
  subscribe?: (params: TParams) => AsyncIterable<TData>;

  /** MCP configuration */
  mcp?: ResourceConfig["mcp"];
}

/**
 * MCP prompt template configuration
 */
export interface PromptConfig {
  /** Prompt ID (optional, inferred from filename) */
  id?: string;

  /** Prompt description */
  description: string;

  /** Static prompt content */
  content?: string;

  /**
   * Dynamic prompt generator
   */
  generate?: (variables: Record<string, unknown>) => string | Promise<string>;
}

/**
 * MCP prompt instance
 */
export interface Prompt {
  /** Prompt ID */
  id: string;

  /** Prompt description */
  description: string;

  /**
   * Get prompt content
   */
  getContent: (variables?: Record<string, unknown>) => Promise<string>;
}

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  /** Enable MCP server */
  enabled: boolean;

  /** MCP server port */
  port?: number;

  /** Authentication configuration */
  auth?: {
    /** Auth type */
    type: "bearer" | "api-key" | "none";

    /**
     * Validate authentication
     */
    validate?: (token: string) => Promise<boolean> | boolean;
  };

  /** CORS configuration */
  cors?: {
    enabled: boolean;
    origins?: string[];
  };
}

/**
 * MCP registry
 */
export interface MCPRegistry {
  /** Registered tools */
  tools: Map<string, import("./tool.ts").Tool>;

  /** Registered resources */
  resources: Map<string, Resource>;

  /** Registered prompts */
  prompts: Map<string, Prompt>;
}
