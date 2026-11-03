import { connectors } from "./_data.ts";
import { ALL_INTEGRATION_NAMES } from "./schema.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import {
  forEachPrivateArray,
  joinPrivateArray,
  pushPrivateArray,
} from "#veryfront/security/private-array.ts";

import { privateTextEndsWith, privateTextSlice } from "#veryfront/security/private-text.ts";
import { parseIntegrationToolIdentity } from "./source-policy.ts";
import type { IntegrationToolMeta } from "./schema.ts";

const declaredIntegrations = createPrivateSet<string>(ALL_INTEGRATION_NAMES);

/**
 * The catalog entry for an exact `integration__tool` name, or undefined when the catalog has none.
 *
 * Indexed loops, not `Array.prototype.find`: agent and config code share this realm and may have
 * replaced the built-ins by the time a run resolves its tools.
 */
export function findCatalogIntegrationTool(toolName: string): IntegrationToolMeta | undefined {
  const identity = parseIntegrationToolIdentity(toolName);
  if (!identity) return undefined;
  for (let index = 0; index < connectors.length; index++) {
    const connector = connectors[index]!;
    if (connector.name !== identity.integration) continue;
    const tools = connector.tools;
    for (let toolIndex = 0; toolIndex < tools.length; toolIndex++) {
      const tool = tools[toolIndex]!;
      if ((tool.id ?? tool.name) === toolName) return tool;
    }
    return undefined;
  }
  return undefined;
}

export interface UnconnectedIntegrationTarget {
  readonly projectSlug: string;
  readonly studioOrigin?: string;
}

/**
 * Integrations that the configured tool names declare but the project has not connected.
 *
 * A name qualifies only when it is an exact catalog tool and discovery returned no tool for its
 * integration. A name the catalog lacks, or whose integration has discovered tools, is a
 * misspelling, not a missing connection: connecting cannot fix it.
 */
export function findUnconnectedIntegrations(
  configuredToolNames: readonly string[],
  discoveredToolNames: readonly string[],
): { integrations: string[]; unknownToolNames: string[] } {
  const discovered = createPrivateSet<string>();
  forEachPrivateArray(discoveredToolNames, (name) => {
    const identity = parseIntegrationToolIdentity(name);
    if (identity) discovered.add(identity.integration);
  });

  const integrations = createPrivateSet<string>();
  const unknownToolNames: string[] = [];
  forEachPrivateArray(configuredToolNames, (name) => {
    const identity = parseIntegrationToolIdentity(name);
    if (
      identity && declaredIntegrations.has(identity.integration) &&
      !discovered.has(identity.integration) && findCatalogIntegrationTool(name) !== undefined
    ) {
      integrations.add(identity.integration);
    } else {
      pushPrivateArray(unknownToolNames, name);
    }
  });
  return { integrations: [...integrations], unknownToolNames };
}

function trimTrailingSlash(origin: string): string {
  return privateTextEndsWith(origin, "/") ? privateTextSlice(origin, 0, origin.length - 1) : origin;
}

function integrationDisplayName(integration: string): string {
  for (let index = 0; index < connectors.length; index++) {
    const connector = connectors[index]!;
    if (connector.name === integration) return connector.displayName;
  }
  return integration;
}

/** Name the missing connection and the exact command that fixes it. */
export function formatUnconnectedIntegrationMessage(
  integration: string,
  target: UnconnectedIntegrationTarget,
): string {
  const lines = [
    `${integrationDisplayName(integration)} isn't connected to project ${target.projectSlug}.`,
    `Connect it: npx veryfront integration connect ${integration} --project ${target.projectSlug}`,
  ];
  if (target.studioOrigin) {
    pushPrivateArray(
      lines,
      `Or in Studio: ${trimTrailingSlash(target.studioOrigin)}/projects/${
        encodeURIComponent(target.projectSlug)
      }/integrations`,
    );
  }
  return joinPrivateArray(lines, "\n");
}
