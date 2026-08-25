import "#veryfront/schemas/_test-setup.ts";
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

  it("preserves a declared value allowlist", () => {
    const parsed = getIntegrationEndpointParamSchema().parse({
      type: "string",
      in: "path",
      description: "Datadog site domain",
      default: "datadoghq.com",
      enum: ["datadoghq.com", "datadoghq.eu"],
    });

    assertEquals(parsed.enum, ["datadoghq.com", "datadoghq.eu"]);
  });
});
