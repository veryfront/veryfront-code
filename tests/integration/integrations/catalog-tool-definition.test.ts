import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { getCatalogToolDefinition } from "#veryfront/integrations/catalog-tool-definition.ts";
import { connectors } from "#veryfront/integrations/_data.ts";
import { getAvailableTools } from "#veryfront/agent/runtime/tool-helpers.ts";

const awsToolIds = [
  "list-s3-buckets",
  "list-s3-objects",
  "get-s3-object",
  "list-ec2-instances",
  "list-lambda-functions",
];

describe("catalog tool names", () => {
  it("covers every AWS catalog entry without an explicit ID", () => {
    const aws = connectors.find((connector) => connector.name === "aws")!;
    assertEquals(
      aws.tools.filter((tool) => tool.id === undefined).map((tool) => tool.name),
      awsToolIds,
    );
  });

  for (const id of awsToolIds) {
    it(`resolves aws__${id} from its connector-local catalog name`, () => {
      const definition = getCatalogToolDefinition(`aws__${id}`);
      assertEquals(definition?.name, `aws__${id}`);
      assertEquals(definition?.parameters, {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      });
      assertEquals(getCatalogToolDefinition(id), undefined);
    });
  }

  it("preserves canonical IDs and does not resolve typos or duplicate namespaces", () => {
    for (const id of ["salesforce__get_case", "shopify__list_products"]) {
      assertEquals(getCatalogToolDefinition(id)?.name, id);
    }
    for (const id of ["aws__list-s3-bukets", "salesforce__get_cse", "aws__aws__list-s3-buckets"]) {
      assertEquals(getCatalogToolDefinition(id), undefined);
    }
  });

  it("exposes all five declared AWS tools after successful empty platform discovery", async () => {
    const env = { VERYFRONT_API_URL: "https://api.test", VERYFRONT_API_TOKEN: "token" };
    const previous = new Map(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
    let requests = 0;
    try {
      for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
      const names = awsToolIds.map((id) => `aws__${id}`);
      await withMockFetch(() => {
        requests++;
        return Promise.resolve(Response.json({ tools: [] }));
      }, async () => {
        const definitions = await getAvailableTools(
          Object.fromEntries(names.map((name) => [name, true])),
        );
        assertEquals(definitions.map((definition) => definition.name), names);
      });
      assertEquals(requests, 1);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
    }
  });
});
