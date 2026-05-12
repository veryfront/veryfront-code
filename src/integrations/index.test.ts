import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { connectors, icons } from "./_data.ts";
import { getConnector, getConnectorNames, getIcon, listConnectors } from "./index.ts";

describe("integrations/index", () => {
  it("exposes generated connector data through lookup helpers", () => {
    assertStrictEquals(listConnectors(), connectors);
    assertEquals(getConnectorNames(), connectors.map((connector) => connector.name));
    assertStrictEquals(
      getConnector("github"),
      connectors.find((connector) => connector.name === "github"),
    );
    assertEquals(getIcon("github"), icons.github);
  });

  it("returns undefined for unknown connector lookups", () => {
    assertEquals(getConnector("missing-integration"), undefined);
    assertEquals(getIcon("missing-integration"), undefined);
  });
});
