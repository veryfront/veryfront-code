import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as direct from "./index.ts";
import * as packageAlias from "veryfront/resource";

describe("resource public surface", () => {
  it("exports the exact runtime contract through the package alias", () => {
    assertEquals(Object.keys(direct).sort(), ["resource", "resourceRegistry"]);
    assertEquals(Object.keys(packageAlias).sort(), Object.keys(direct).sort());
    assertStrictEquals(packageAlias.resource, direct.resource);
    assertStrictEquals(packageAlias.resourceRegistry, direct.resourceRegistry);
  });
});
