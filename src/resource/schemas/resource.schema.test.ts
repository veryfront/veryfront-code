import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getCachePolicySchema, getMcpConfigSchema } from "./resource.schema.ts";

describe("resource schemas", () => {
  it("accepts only documented cache policies", () => {
    assertEquals(getCachePolicySchema().safeParse("cache-first").success, true);
    assertEquals(getCachePolicySchema().safeParse("sometimes").success, false);
  });

  it("rejects unknown MCP configuration properties", () => {
    assertEquals(getMcpConfigSchema().safeParse({ enabled: true }).success, true);
    assertEquals(
      getMcpConfigSchema().safeParse({ enabled: true, unexpected: true }).success,
      false,
    );
  });
});
