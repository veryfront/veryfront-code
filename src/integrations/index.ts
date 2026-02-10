/**
 * @module integrations
 * Integration metadata and SVG icons for all connectors.
 *
 * @example
 * ```ts
 * import { listConnectors, getIcon } from "veryfront/integrations";
 *
 * const connectors = listConnectors();
 * const slackIcon = getIcon("slack"); // raw SVG string
 * ```
 */
export type {
  EnvVarConfig,
  IntegrationConfig,
  IntegrationName,
  IntegrationPrompt,
  IntegrationToolMeta,
  OAuthConfig,
  OAuthField,
} from "./schema.ts";

export {
  EnvVarSchema,
  IntegrationConfigSchema,
  IntegrationNameSchema,
  IntegrationPromptSchema,
  IntegrationToolSchema,
  OAuthConfigSchema,
  OAuthFieldSchema,
} from "./schema.ts";

import { connectors, icons } from "./_data.ts";
import type { IntegrationConfig, IntegrationName } from "./schema.ts";

const byName = new Map(
  connectors.map((c): [string, IntegrationConfig] => [c.name, c]),
);
const iconMap = new Map(Object.entries(icons));
const connectorNames: readonly string[] = connectors.map((c) => c.name);

export function getConnector(name: IntegrationName | string): IntegrationConfig | undefined {
  return byName.get(name);
}

export function listConnectors(): readonly IntegrationConfig[] {
  return connectors;
}

export function getConnectorNames(): readonly string[] {
  return connectorNames;
}

export function getIcon(name: IntegrationName | string): string | undefined {
  return iconMap.get(name);
}

// Runtime integration tools (connector fetching, tool generation, MCP registration)
export { clearConnectorCache, fetchConnector } from "./connector-fetcher.ts";
export { createIntegrationTools } from "./tool-factory.ts";
export { executeEndpoint } from "./endpoint-executor.ts";
export { type IntegrationMCPConfig, registerIntegrationMCP } from "./mcp-registration.ts";
export type { IntegrationConnector, IntegrationRuntimeConfig, IntegrationTool } from "./types.ts";
