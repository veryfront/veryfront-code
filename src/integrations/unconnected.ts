import { connectors } from "./_data.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import {
  forEachPrivateArray,
  joinPrivateArray,
  pushPrivateArray,
} from "#veryfront/security/private-array.ts";

import { privateTextEndsWith, privateTextSlice } from "#veryfront/security/private-text.ts";
import { parseIntegrationToolIdentity } from "./source-policy.ts";

const catalogToolNames = createPrivateSet<string>();
forEachPrivateArray(connectors, (connector) => {
  forEachPrivateArray(connector.tools, (tool) => catalogToolNames.add(tool.id ?? tool.name));
});

export interface UnconnectedIntegrationTarget {
  readonly projectSlug: string;
  readonly studioOrigin?: string;
}

/**
 * Integrations that the configured tool names declare but the project has not connected.
 *
 * A name qualifies only when it is a canonical `integration__tool` name present in the catalog and discovery returned no tool for that integration. A name whose integration
 * has discovered tools is a misspelling, not a missing connection.
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
      identity && catalogToolNames.has(name) &&
      !discovered.has(identity.integration)
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
