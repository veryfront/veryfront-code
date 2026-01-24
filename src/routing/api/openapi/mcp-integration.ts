import { registerResource, registerTool } from "#veryfront/mcp";
import type { Resource } from "#veryfront/resource";
import { logger } from "#veryfront/utils";
import { createOpenAPIResource } from "./mcp-resource.ts";
import { generateMCPToolsFromSpec } from "./mcp-tools.ts";
import type { OpenAPISpec } from "./types.ts";

export interface OpenAPIMCPConfig {
  baseUrl: string;
  resource?: boolean;
  tools?: boolean;
  toolPrefix?: string;
  headers?: Record<string, string>;
}

export async function registerOpenAPIMCP(
  getSpec: () => Promise<OpenAPISpec>,
  config: OpenAPIMCPConfig,
): Promise<{ resourceId?: string; toolIds: string[] }> {
  const result: { resourceId?: string; toolIds: string[] } = { toolIds: [] };

  if (config.resource !== false) {
    try {
      const resource = createOpenAPIResource(getSpec);
      registerResource("openapi_spec", resource as Resource);
      result.resourceId = "openapi_spec";
      logger.debug("[OpenAPI MCP] Registered openapi://spec resource");
    } catch (error) {
      logger.warn("[OpenAPI MCP] Failed to register resource:", { error: String(error) });
    }
  }

  if (config.tools === false) {
    return result;
  }

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
      prefix: config.toolPrefix ?? "api",
    });
  } catch (error) {
    logger.warn("[OpenAPI MCP] Failed to generate tools:", { error: String(error) });
  }

  return result;
}

export function isOpenAPIMCPEnabled(config?: {
  openapi?: {
    enabled?: boolean;
    mcp?: {
      resource?: boolean;
      tools?: boolean;
    };
  };
}): boolean {
  if (config?.openapi?.enabled === false) {
    return false;
  }

  const mcp = config?.openapi?.mcp;
  if (!mcp) {
    return true;
  }

  return mcp.resource !== false || mcp.tools !== false;
}
