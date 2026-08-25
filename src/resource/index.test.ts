import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import * as resourceApi from "./index.ts";

it("exports the resource factory and registry from the public barrel", () => {
  assertEquals(typeof resourceApi.resource, "function");
  assertEquals(typeof resourceApi.resourceRegistry.register, "function");
  assertEquals(typeof resourceApi.resourceRegistry.findByPattern, "function");
});
