import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { connectors, icons } from "./_data.ts";
import { EXPERIMENTAL_INTEGRATIONS_ENV, filterVisibleIntegrations } from "./feature-flags.ts";
import { getConnector, getConnectorNames, getIcon, listConnectors } from "./index.ts";
import { MAX_INTEGRATION_NAME_LENGTH } from "./limits.ts";

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
    assertEquals(getConnector(null as unknown as string), undefined);
    assertEquals(getIcon(undefined as unknown as string), undefined);
    assertEquals(getConnector("x".repeat(MAX_INTEGRATION_NAME_LENGTH + 1)), undefined);
    assertEquals(getIcon("x".repeat(MAX_INTEGRATION_NAME_LENGTH + 1)), undefined);
  });

  it("normalizes public connector and icon lookup names", () => {
    assertStrictEquals(
      getConnector(" GitHub "),
      connectors.find((connector) => connector.name === "github"),
    );
    assertEquals(getIcon("GITHUB"), icons.github);

    Deno.env.set(EXPERIMENTAL_INTEGRATIONS_ENV, "salesforce");
    assertStrictEquals(
      getConnector(" SALESFORCE "),
      connectors.find((connector) => connector.name === "salesforce"),
    );
    assertEquals(getIcon("Salesforce"), icons.salesforce);
  });

  it("does not expose mutable shared catalog state", () => {
    const github = getConnector("github");
    if (!github) throw new Error("Expected the GitHub connector");
    const originalDisplayName = github.displayName;
    const firstTool = github.tools[0];
    if (!firstTool) throw new Error("Expected the GitHub connector to expose a tool");
    const originalToolDescription = firstTool.description;

    assertEquals(Object.isFrozen(github), true);
    assertEquals(Object.isFrozen(github.auth), true);
    assertEquals(Object.isFrozen(github.tools), true);
    assertEquals(Object.isFrozen(firstTool), true);
    assertThrows(() => {
      github.displayName = "poisoned";
    }, TypeError);
    assertThrows(() => {
      firstTool.description = "poisoned";
    }, TypeError);

    assertEquals(getConnector("github")?.displayName, originalDisplayName);
    assertEquals(getConnector("github")?.tools[0]?.description, originalToolDescription);
  });
});
