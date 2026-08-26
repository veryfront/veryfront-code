import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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

  it("accepts enums only for string parameters", () => {
    const schema = getIntegrationEndpointParamSchema();
    assertEquals(
      schema.parse({
        type: "string",
        in: "path",
        description: "Provider host",
        enum: ["api.example.com"],
      }).enum,
      ["api.example.com"],
    );
    assertThrows(() =>
      schema.parse({
        type: "number",
        in: "query",
        description: "Page size",
        enum: ["10"],
      })
    );
  });
});
