/**
 * Integration MCP Registration
 *
 * Registers integration tools into the global MCP tool registry.
 * Called during MCP server initialization when integrations are configured.
 *
 * Similar to registerOpenAPIMCP but for third-party integration tools.
 */

import { registerTool } from "#veryfront/mcp";
import { logger } from "#veryfront/utils";
import { fetchConnector } from "./connector-fetcher.ts";
import { createIntegrationTools } from "./tool-factory.ts";
import type { IntegrationRuntimeConfig } from "./types.ts";

export interface IntegrationMCPConfig {
  /** Record of integration name → config from veryfront.config.ts */
  integrations: Record<string, IntegrationRuntimeConfig | undefined>;
  /** API base URL for fetching connectors and tokens */
  apiBaseUrl: string;
  /** API token for authenticated requests */
  apiToken?: string;
}

/**
 * Register integration tools into the MCP tool registry.
 * Fetches connector specs from the API and generates tools for each enabled integration.
 */
export async function registerIntegrationMCP(
  config: IntegrationMCPConfig,
): Promise<{ toolIds: string[] }> {
  const result: { toolIds: string[] } = { toolIds: [] };
  const integrationNames = Object.keys(config.integrations);

  if (integrationNames.length === 0) return result;

  logger.info("[Integrations] Registering integration tools", {
    integrations: integrationNames,
  });

  // Fetch all connectors in parallel
  const connectorResults = await Promise.all(
    integrationNames.map(async (name) => {
      const connector = await fetchConnector(name, config.apiBaseUrl, config.apiToken);
      return { name, connector };
    }),
  );

  for (const { name, connector } of connectorResults) {
    if (!connector) {
      logger.warn(`[Integrations] Skipping ${name}: connector not found`);
      continue;
    }

    const integrationConfig = config.integrations[name] ?? {};
    const tools = createIntegrationTools(
      connector,
      integrationConfig,
      config.apiBaseUrl,
      config.apiToken,
    );

    for (const tool of tools) {
      registerTool(tool.id, tool);
      result.toolIds.push(tool.id);
    }
  }

  logger.info("[Integrations] Registered integration tools", {
    total: result.toolIds.length,
    integrations: integrationNames.length,
  });

  return result;
}
