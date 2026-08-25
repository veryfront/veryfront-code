import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { IntegrationToolMeta } from "#veryfront/integrations/schema.ts";
import {
  executeLocalIntegrationEndpoint,
  type LocalIntegrationEndpointTransport,
} from "#veryfront/integrations/local-endpoint-executor.ts";

type IntegrationEndpoint = NonNullable<IntegrationToolMeta["endpoint"]>;

const SECRET = "<TOKEN>";
const defineProperty = Object.defineProperty;
const deleteProperty = Reflect.deleteProperty;

function execute(
  endpoint: IntegrationEndpoint,
  args: Record<string, unknown>,
  allowedOrigin: string,
  transport: LocalIntegrationEndpointTransport,
): Promise<unknown> {
  return executeLocalIntegrationEndpoint({
    connectorName: "example",
    toolId: "example__test",
    endpoint,
    args,
    authHeaders: { Authorization: `Bearer ${SECRET}` },
    allowedOrigin,
    transport,
  });
}

describe("local endpoint pattern boundary", () => {
  it("enforces endpoint parameter patterns before transport", async () => {
    const requests: string[] = [];
    const transport: LocalIntegrationEndpointTransport = (request) => {
      requests.push(request.url.href);
      return Promise.resolve(Response.json({ ok: true }));
    };
    const endpoint: IntegrationEndpoint = {
      method: "GET",
      url: "https://{instanceHost}/api/now/v1/table/incident",
      params: {
        instanceHost: {
          type: "string",
          in: "path",
          description: "ServiceNow instance host",
          pattern: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.service-now\\.com$",
          required: true,
        },
      },
    };

    await assertRejects(
      () =>
        execute(
          endpoint,
          { instanceHost: "attacker.example" },
          "https://attacker.example",
          transport,
        ),
      VeryfrontError,
    );
    await execute(
      endpoint,
      { instanceHost: "example.service-now.com" },
      "https://example.service-now.com",
      transport,
    );

    assertEquals(requests, ["https://example.service-now.com/api/now/v1/table/incident"]);
  });

  it("ignores a polluted Object.prototype.pattern", async () => {
    const requests: string[] = [];
    const transport: LocalIntegrationEndpointTransport = (request) => {
      requests.push(request.url.href);
      return Promise.resolve(Response.json({ ok: true }));
    };
    let getterCalls = 0;
    defineProperty(Object.prototype, "pattern", {
      configurable: true,
      get(): string {
        getterCalls += 1;
        return "^only-polluted-values$";
      },
    });

    try {
      await execute(
        {
          method: "GET",
          url: "https://api.example.test/items/{itemId}",
          params: {
            itemId: {
              type: "string",
              in: "path",
              description: "Item ID",
              required: true,
            },
          },
        },
        { itemId: "item-1" },
        "https://api.example.test",
        transport,
      );

      const error = await assertRejects(
        () =>
          execute(
            {
              method: "GET",
              url: "https://api.example.test/items/{itemId}",
              params: {
                itemId: {
                  type: "string",
                  in: "path",
                  description: "Item ID",
                  pattern: "^item-[0-9]+$",
                  required: true,
                },
              },
            },
            { itemId: "attacker.example" },
            "https://api.example.test",
            transport,
          ),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-request-invalid");
    } finally {
      deleteProperty(Object.prototype, "pattern");
    }

    assertEquals(getterCalls, 0);
    assertEquals(requests, ["https://api.example.test/items/item-1"]);
  });
});
