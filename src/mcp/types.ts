/**
 * MCP Types
 *
 * Type definitions for the Model Context Protocol.
 *
 * @module veryfront/mcp
 */

import type { Tool } from "#veryfront/tool";
import type { Resource } from "#veryfront/resource";
import type { Prompt } from "#veryfront/prompt";

/**
 * MCP registry containing all registered tools, resources, and prompts
 */
export interface MCPRegistry {
  /** Registered tools */
  tools: Map<string, Tool>;

  /** Registered resources */
  resources: Map<string, Resource>;

  /** Registered prompts */
  prompts: Map<string, Prompt>;
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
 * MCP registry stats
 */
export interface MCPStats {
  tools: number;
  resources: number;
  prompts: number;
  total: number;
}
