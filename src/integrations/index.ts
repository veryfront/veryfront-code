/**
 * @module integrations
 * Integration metadata and SVG icons for all connectors.
 *
 * @example
 * ```ts
 * import {
 *   getConnector,
 *   getIcon,
 *   getRemoteIntegrationToolDefinitions,
 *   listConnectors,
 * } from "veryfront/integrations";
 *
 * const connectors = listConnectors();
 * const slack = getConnector("slack");
 * const slackIcon = getIcon("slack"); // raw SVG string
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
import {
  filterVisibleIntegrations,
  isVisibleIntegration,
  normalizeIntegrationName,
} from "./feature-flags.ts";
import type { IntegrationConfig, IntegrationName } from "./schema.ts";

const iconMap = new Map(Object.entries(icons));

/** Return a visible connector after trimming and case-normalizing its name. */
export function getConnector(name: IntegrationName | string): IntegrationConfig | undefined {
  if (typeof name !== "string") return undefined;
  const normalizedName = normalizeIntegrationName(name);
  if (!isVisibleIntegration(normalizedName)) return undefined;
  return connectors.find((connector) => connector.name === normalizedName);
}

/** List connectors. */
export function listConnectors(): readonly IntegrationConfig[] {
  return filterVisibleIntegrations(connectors);
}

/** Return connector names. */
export function getConnectorNames(): readonly string[] {
  return listConnectors().map((connector) => connector.name);
}

/** Return a visible connector's icon after trimming and case-normalizing its name. */
export function getIcon(name: IntegrationName | string): string | undefined {
  if (typeof name !== "string") return undefined;
  const normalizedName = normalizeIntegrationName(name);
  if (!isVisibleIntegration(normalizedName)) return undefined;
  return iconMap.get(normalizedName);
}

// Remote integration tool helpers (per-request, no global registration)
export {
  executeRemoteIntegrationTool,
  getRemoteIntegrationToolDefinitions,
  isRemoteIntegrationTool,
} from "./remote-tools.ts";
export type { IntegrationConnector, IntegrationTool } from "./types.ts";
