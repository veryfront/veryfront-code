/**
 * OpenAPI MCP Integration
 *
 * Integrates OpenAPI specification with the MCP registry, exposing:
 * - OpenAPI spec as an MCP resource for AI discovery
 * - API routes as MCP tools for AI invocation
 *
 * @module routing/api/openapi/mcp-integration
 */

import { registerResource, registerTool } from "@veryfront/mcp";
import { createOpenAPIResource } from "./mcp-resource.ts";
import { generateMCPToolsFromSpec } from "./mcp-tools.ts";
import type { OpenAPISpec } from "./types.ts";
import type { Resource } from "@veryfront/resource";
import { logger } from "@veryfront/utils";

/**
 * Configuration for OpenAPI MCP integration.
 */
export interface OpenAPIMCPConfig {
  /** Base URL for API calls */
  baseUrl: string;
  /** Enable OpenAPI spec as MCP resource (default: true) */
  resource?: boolean;
  /** Enable auto-generated MCP tools from routes (default: true) */
  tools?: boolean;
  /** Tool naming prefix (default: "api") */
  toolPrefix?: string;
  /** Additional headers for API calls */
  headers?: Record<string, string>;
}

/**
 * Register OpenAPI spec and tools with the MCP registry.
 *
 * This function should be called during server initialization after
 * routes have been discovered.
 *
 * @param getSpec - Function that returns the OpenAPI specification
 * @param config - MCP integration configuration
 *
 * @example
 * ```typescript
 * await registerOpenAPIMCP(
 *   async () => generateOpenAPISpec(router, projectDir, adapter, config),
 *   {
 *     baseUrl: "http://localhost:3000",
 *     resource: true,
 *     tools: true,
 *     toolPrefix: "api",
 *   }
 * );
 * ```
 */
export async function registerOpenAPIMCP(
  getSpec: () => Promise<OpenAPISpec>,
  config: OpenAPIMCPConfig,
): Promise<{ resourceId?: string; toolIds: string[] }> {
  const result: { resourceId?: string; toolIds: string[] } = {
    toolIds: [],
  };

  // Register OpenAPI spec as MCP resource
  if (config.resource !== false) {
    try {
      const resource = createOpenAPIResource(getSpec);
      // Cast to Resource to satisfy the registry's generic type
      registerResource("openapi_spec", resource as Resource);
      result.resourceId = "openapi_spec";
      logger.debug("[OpenAPI MCP] Registered openapi://spec resource");
    } catch (error) {
      logger.warn("[OpenAPI MCP] Failed to register resource:", { error: String(error) });
    }
  }

  // Generate and register API tools
  if (config.tools !== false) {
    try {
      const spec = await getSpec();
      const tools = generateMCPToolsFromSpec(spec, {
        baseUrl: config.baseUrl,
        toolPrefix: config.toolPrefix,
        headers: config.headers,
      });

      for (const tool of tools) {
        registerTool(tool.id, tool);
        result.toolIds.push(tool.id);
      }

      logger.info("[OpenAPI MCP] Registered API tools", {
        count: tools.length,
        prefix: config.toolPrefix || "api",
      });
    } catch (error) {
      logger.warn("[OpenAPI MCP] Failed to generate tools:", { error: String(error) });
    }
  }

  return result;
}

/**
 * Check if OpenAPI MCP integration is enabled in config.
 */
export function isOpenAPIMCPEnabled(config?: {
  openapi?: {
    enabled?: boolean;
    mcp?: {
      resource?: boolean;
      tools?: boolean;
    };
  };
}): boolean {
  // OpenAPI must be enabled
  if (config?.openapi?.enabled === false) {
    return false;
  }

  // At least one of resource or tools must be enabled
  const mcp = config?.openapi?.mcp;
  if (!mcp) {
    return true; // Default: enabled
  }

  return mcp.resource !== false || mcp.tools !== false;
}
