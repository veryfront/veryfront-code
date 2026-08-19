/**
 * @module integrations
 * Integration metadata and SVG icons for all connectors.
 *
 * @example
 * ```ts
 * import {
 *   getConnector,
 *   getIcon,
 *   getRemoteIntegrationToolDiscovery,
 *   getRemoteIntegrationToolDefinitions,
 *   createSalesforceServiceAccountToolSource,
 *   listConnectors,
 * } from "veryfront/integrations";
 *
 * const connectors = listConnectors();
 * const slack = getConnector("slack");
 * const slackIcon = getIcon("slack"); // raw SVG string
 * const discovery = await getRemoteIntegrationToolDiscovery();
 * const runtimeTools = await getRemoteIntegrationToolDefinitions();
 * ```
 */
export type {
  EnvVarConfig,
  IntegrationConfig,
  IntegrationEndpointHistoricalSummary,
  IntegrationName,
  IntegrationPrompt,
  IntegrationToolMeta,
  OAuthConfig,
  OAuthField,
} from "./schema.ts";

export {
  EnvVarSchema,
  IntegrationConfigSchema,
  IntegrationEndpointHistoricalSummarySchema,
  IntegrationNameSchema,
  IntegrationPromptSchema,
  IntegrationToolSchema,
  OAuthConfigSchema,
  OAuthFieldSchema,
} from "./schema.ts";

import { connectors, icons } from "./_data.ts";
import { filterCatalogVisibleIntegrations, isCatalogVisibleIntegration } from "./feature-flags.ts";
import type { IntegrationConfig, IntegrationName } from "./schema.ts";

const iconMap = new Map(Object.entries(icons));

/** Return connector. */
export function getConnector(name: IntegrationName | string): IntegrationConfig | undefined {
  if (!isCatalogVisibleIntegration(name)) return undefined;
  return connectors.find((connector) => connector.name === name);
}

/** List connectors. */
export function listConnectors(): readonly IntegrationConfig[] {
  return filterCatalogVisibleIntegrations(connectors);
}

/** Return connector names. */
export function getConnectorNames(): readonly string[] {
  return listConnectors().map((connector) => connector.name);
}

/** Return icon. */
export function getIcon(name: IntegrationName | string): string | undefined {
  if (!isCatalogVisibleIntegration(name)) return undefined;
  return iconMap.get(name);
}

// Remote integration tool helpers (per-request, no global registration)
export {
  executeRemoteIntegrationTool,
  getRemoteIntegrationToolDefinitions,
  getRemoteIntegrationToolDiscovery,
  isRemoteIntegrationTool,
} from "./remote-tools.ts";
export type { RemoteIntegrationToolDiscoveryResult } from "./remote-tools.ts";
export { createLocalIntegrationToolSource } from "./local-tool-source.ts";
export type {
  LocalIntegrationCredentialProvider,
  LocalIntegrationToolSourceOptions,
} from "./local-tool-source.ts";
export type { IntegrationConnector, IntegrationTool } from "./types.ts";

export {
  createSalesforceServiceAccountToolSource,
  SALESFORCE_SERVICE_ACCOUNT_ENV_VARS,
} from "./salesforce-service-account.ts";
export type { SalesforceServiceAccountToolSourceOptions } from "./salesforce-service-account.ts";
