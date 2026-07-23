import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { connectors, icons } from "./_data.ts";
import { EXPERIMENTAL_INTEGRATIONS_ENV, filterVisibleIntegrations } from "./feature-flags.ts";
import { getConnector, getConnectorNames, getIcon, listConnectors } from "./index.ts";
import * as integrationExports from "./index.ts";

describe("integrations/index", () => {
  afterEach(() => Deno.env.delete(EXPERIMENTAL_INTEGRATIONS_ENV));

  it("exposes default-visible connector data through lookup helpers", () => {
    const visibleConnectors = filterVisibleIntegrations(connectors);

    assertEquals(listConnectors(), visibleConnectors);
    assertEquals(getConnectorNames(), visibleConnectors.map((connector) => connector.name));
    assertStrictEquals(
      getConnector("github"),
      connectors.find((connector) => connector.name === "github"),
    );
    assertEquals(getIcon("github"), icons.github);
  });

  it("hides feature-gated connectors by default", () => {
    assertEquals(getConnector("salesforce"), undefined);
    assertEquals(getIcon("salesforce"), undefined);
    assertEquals(getConnectorNames().includes("salesforce"), false);
  });

  it("shows feature-gated connectors when explicitly enabled", () => {
    Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, "salesforce");

    assertStrictEquals(
      getConnector("salesforce"),
      connectors.find((connector) => connector.name === "salesforce"),
    );
    assertEquals(getIcon("salesforce"), icons.salesforce);
    assertEquals(getConnectorNames().includes("salesforce"), true);
  });

  it("returns undefined for unknown connector lookups", () => {
    assertEquals(getConnector("missing-integration"), undefined);
    assertEquals(getIcon("missing-integration"), undefined);
  });

  it("normalizes case and surrounding whitespace consistently for lookups", () => {
    assertStrictEquals(getConnector(" GitHub "), getConnector("github"));
    assertEquals(getIcon(" GITHUB "), getIcon("github"));
  });

  it("exposes immutable catalog snapshots", () => {
    const connectorList = listConnectors();
    const connector = getConnector("github");
    const names = getConnectorNames();

    assertEquals(Object.isFrozen(connectorList), true);
    assertEquals(Object.isFrozen(names), true);
    assertEquals(Object.isFrozen(connector), true);
    assertEquals(Object.isFrozen(connector?.tools), true);
    assertThrows(() => (connectorList as unknown[]).pop(), TypeError);
    assertThrows(
      () => ((connector as { displayName: string }).displayName = "Mutated"),
      TypeError,
    );
  });

  it("keeps the public runtime export surface explicit", () => {
    assertEquals(Object.keys(integrationExports).sort(), [
      "EnvVarSchema",
      "IntegrationConfigSchema",
      "IntegrationEndpointHistoricalSummarySchema",
      "IntegrationNameSchema",
      "IntegrationPromptSchema",
      "IntegrationToolSchema",
      "OAuthConfigSchema",
      "OAuthFieldSchema",
      "executeRemoteIntegrationTool",
      "getConnector",
      "getConnectorNames",
      "getIcon",
      "getRemoteIntegrationToolDefinitions",
      "isRemoteIntegrationTool",
      "listConnectors",
    ]);
  });
});
