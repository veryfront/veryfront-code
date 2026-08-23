import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  cachePolicySchema,
  getCachePolicySchema,
  getMcpConfigSchema,
  McpConfigSchema,
} from "./resource.schema.ts";

describe("resource schemas", () => {
  it("accepts every supported cache policy", () => {
    for (const policy of ["no-cache", "cache", "cache-first"] as const) {
      assertEquals(getCachePolicySchema().parse(policy), policy);
      assertEquals(cachePolicySchema.parse(policy), policy);
    }
  });

  it("rejects unsupported cache policies", () => {
    assertThrows(() => getCachePolicySchema().parse("stale-while-revalidate"));
  });

  it("validates current and compatibility MCP config schemas", () => {
    const config = { enabled: false, cachePolicy: "cache-first" as const };

    assertEquals(getMcpConfigSchema().parse(config), config);
    assertEquals(McpConfigSchema.parse(config), config);
    assertThrows(() => getMcpConfigSchema().parse({ enabled: "yes" }));
  });
});
