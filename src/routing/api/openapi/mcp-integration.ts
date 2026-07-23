import { registerResource, registerTool } from "#veryfront/mcp";
import { logger as baseLogger } from "#veryfront/utils";
import { resourceRegistry } from "#veryfront/resource";
import { toolRegistry } from "#veryfront/tool";
import { createOpenAPIResource } from "./mcp-resource.ts";
import { generateMCPToolsFromSpec } from "./mcp-tools.ts";
import type { OpenAPISpec } from "./types.ts";

const logger = baseLogger.component("open-api-mcp");

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
  const shouldRegisterResource = config.resource !== false;
  const shouldRegisterTools = config.tools !== false;
  const resource = shouldRegisterResource ? createOpenAPIResource(getSpec) : undefined;
  const tools = shouldRegisterTools
    ? generateMCPToolsFromSpec(await getSpec(), {
      baseUrl: config.baseUrl,
      toolPrefix: config.toolPrefix,
      headers: config.headers,
    })
    : [];
  const rollback: Array<() => void> = [];

  try {
    if (resource) {
      const previous = resourceRegistry.getOwn("openapi_spec");
      registerResource("openapi_spec", resource);
      rollback.push(() => {
        resourceRegistry.delete("openapi_spec");
        if (previous) resourceRegistry.register("openapi_spec", previous);
      });
      result.resourceId = "openapi_spec";
      logger.debug("Registered openapi://spec resource");
    }

    for (const tool of tools) {
      const previous = toolRegistry.getOwn(tool.id);
      registerTool(tool.id, tool);
      rollback.push(() => {
        toolRegistry.delete(tool.id);
        if (previous) toolRegistry.register(tool.id, previous);
      });
      result.toolIds.push(tool.id);
    }

    logger.info("Registered API tools", {
      count: tools.length,
      prefix: config.toolPrefix ?? "api",
    });
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const undo of rollback.reverse()) {
      try {
        undo();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "OpenAPI MCP registration and rollback failed",
      );
    }
    throw error;
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
