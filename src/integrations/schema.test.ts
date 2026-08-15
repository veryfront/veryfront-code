import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getIntegrationEndpointParamSchema } from "./schema.ts";

describe("IntegrationEndpointParamSchema", () => {
  it("preserves an explicit model-facing default opt-in", () => {
    const parsed = getIntegrationEndpointParamSchema().parse({
      type: "string",
      in: "query",
      description: "SOQL query",
      default: "SELECT Id FROM Case LIMIT 50",
      exposeDefault: true,
    });

    assertEquals(parsed.exposeDefault, true);
  });
});
