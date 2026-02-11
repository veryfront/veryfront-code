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
} from "./types.ts";

import type { IntegrationConfig } from "./types.ts";
import { CONNECTORS } from "./_connectors.ts";
import { ICONS } from "./_icons.ts";

export function getConnector(name: string): IntegrationConfig | undefined {
  return CONNECTORS.get(name);
}

export function listConnectors(): IntegrationConfig[] {
  return [...CONNECTORS.values()];
}

export function getConnectorNames(): string[] {
  return [...CONNECTORS.keys()];
}

export function getIcon(name: string): string | undefined {
  return ICONS.get(name);
}
