import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { IntegrationToolMeta } from "./schema.ts";
import {
  executeLocalIntegrationEndpoint,
  type LocalIntegrationEndpointTransport,
} from "./local-endpoint-executor.ts";

type IntegrationEndpoint = NonNullable<IntegrationToolMeta["endpoint"]>;

const SECRET = "LOCAL_ENDPOINT_SECRET_MUST_NOT_LEAK";

function endpoint(value: IntegrationEndpoint): IntegrationEndpoint {
  return value;
}

describe("local integration endpoint executor", () => {
  it(
    "builds a bounded REST request from catalog path, query, header, and body fields",
    async () => {
      const requests: Array<{ url: string; init: RequestInit; allowedOrigin: string }> = [];
      const transport: LocalIntegrationEndpointTransport = (request) => {
        requests.push({
          url: request.url.href,
          init: request.init,
          allowedOrigin: request.allowedOrigin,
        });
        return Promise.resolve(Response.json({ data: { items: [{ id: "item-1" }] } }));
      };

      const result = await executeLocalIntegrationEndpoint({
        endpoint: endpoint({
          method: "POST",
          url: "https://api.example.test/v1/items/{itemId}",
          params: {
            itemId: {
              type: "string",
              in: "path",
              description: "Item ID",
              required: true,
            },
            limit: {
              type: "number",
              in: "query",
              description: "Page size",
              default: 25,
            },
            tags: {
              type: "string[]",
              in: "query",
              description: "Tags",
            },
            account: {
              type: "string",
              in: "header",
              headerName: "X-Account-ID",
              description: "Account",
              required: true,
            },
          },
          body: {
            count: {
              type: "number",
              description: "Count",
              required: true,
            },
            note: {
              type: "string",
              description: "Note",
              default: "catalog-default",
            },
          },
          response: { transform: "data.items" },
        }),
        args: {
          itemId: "a/b",
          tags: ["red blue", "blue"],
          account: "acct-1",
          count: 2,
        },
        authHeaders: { Authorization: `Bearer ${SECRET}` },
        allowedOrigin: "https://api.example.test",
        transport,
      });

      assertEquals(result, [{ id: "item-1" }]);
      assertEquals(requests.length, 1);
      assertEquals(
        requests[0]?.url,
        "https://api.example.test/v1/items/a%2Fb?limit=25&tags=red+blue&tags=blue",
      );
      assertEquals(requests[0]?.allowedOrigin, "https://api.example.test");
      assertEquals(requests[0]?.init.method, "POST");
      assertEquals(requests[0]?.init.redirect, "error");
      assertEquals(
        new Headers(requests[0]?.init.headers).get("authorization"),
        `Bearer ${SECRET}`,
      );
      assertEquals(new Headers(requests[0]?.init.headers).get("x-account-id"), "acct-1");
      assertEquals(
        new Headers(requests[0]?.init.headers).get("content-type"),
        "application/json",
      );
      assertEquals(requests[0]?.init.body, '{"count":2,"note":"catalog-default"}');
    },
  );

  it("supports passthrough JSON bodies and Microsoft Graph query formatting", async () => {
    let requestBody: BodyInit | null | undefined;
    let requestUrl = "";
    const result = await executeLocalIntegrationEndpoint({
      endpoint: endpoint({
        method: "POST",
        url: "https://api.example.test/search",
        params: {
          search: {
            type: "string",
            in: "query",
            queryName: "$search",
            queryValueFormat: "microsoft-graph-search",
            description: "Search query",
            required: true,
          },
        },
        body: {
          payload: {
            type: "object",
            description: "Request payload",
            required: true,
          },
        },
        bodyMode: "passthrough",
      }),
      args: {
        search: "from:ada@example.test",
        payload: { nested: [true, 3] },
      },
      authHeaders: {},
      allowedOrigin: "https://api.example.test",
      transport: (request) => {
        requestBody = request.init.body;
        requestUrl = request.url.href;
        return Promise.resolve(Response.json({ ok: true }));
      },
    });

    assertEquals(
      requestUrl,
      "https://api.example.test/search?%24search=%22from%3Aada%40example.test%22",
    );
    assertEquals(requestBody, '{"nested":[true,3]}');
    assertEquals(result, { ok: true });
  });

  it("rejects invalid arguments before any transport call", async () => {
    const requiredEndpoint = endpoint({
      method: "GET",
      url: "https://api.example.test/items/{id}",
      params: {
        id: {
          type: "string",
          in: "path",
          description: "Item ID",
          required: true,
        },
        active: {
          type: "boolean",
          in: "query",
          description: "Active",
        },
      },
    });
    let transportCalls = 0;
    const transport: LocalIntegrationEndpointTransport = () => {
      transportCalls += 1;
      return Promise.resolve(Response.json({ ok: true }));
    };

    for (
      const args of [
        {},
        { id: 42 },
        { id: "item", active: "true" },
        { id: "item", unknown: true },
      ]
    ) {
      const error = await assertRejects(
        () =>
          executeLocalIntegrationEndpoint({
            endpoint: requiredEndpoint,
            args,
            authHeaders: {},
            allowedOrigin: "https://api.example.test",
            transport,
          }),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-request-invalid");
    }

    assertEquals(transportCalls, 0);
  });

  it("uses an exact-origin, redirect-rejecting transport contract", async () => {
    let authorized = false;
    await executeLocalIntegrationEndpoint({
      endpoint: endpoint({
        method: "GET",
        url: "https://api.example.test/items",
      }),
      args: {},
      authHeaders: {},
      allowedOrigin: "https://api.example.test",
      transport: (request) => {
        assertEquals(request.url.origin, request.allowedOrigin);
        assertEquals(request.init.redirect, "error");
        assert(request.init.signal instanceof AbortSignal);
        authorized = true;
        return Promise.resolve(Response.json([]));
      },
    });
    assert(authorized);
  });

  it("bounds responses and never exposes provider bodies, URLs, headers, or causes", async () => {
    const fixtures = [
      () => new Response(SECRET, { status: 500 }),
      () => new Response(`{"secret":"${SECRET}"`, { status: 200 }),
      () =>
        new Response("{}", {
          headers: { "content-length": String(4 * 1024 * 1024 + 1) },
        }),
    ];

    for (const response of fixtures) {
      const error = await assertRejects(
        () =>
          executeLocalIntegrationEndpoint({
            endpoint: endpoint({
              method: "GET",
              url: `https://api.example.test/items?credential=${SECRET}`,
            }),
            args: {},
            authHeaders: { Authorization: `Bearer ${SECRET}` },
            allowedOrigin: "https://api.example.test",
            transport: () => Promise.resolve(response()),
          }),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assert(
        error.slug === "local-integration-request-failed" ||
          error.slug === "local-integration-response-invalid",
      );
      assertEquals(error.message.includes(SECRET), false);
      assertEquals(error.cause, undefined);
    }
  });

  it("enforces its deadline and caller cancellation without leaking abort reasons", async () => {
    const abortController = new AbortController();
    const pending = executeLocalIntegrationEndpoint({
      endpoint: endpoint({
        method: "GET",
        url: "https://api.example.test/slow",
      }),
      args: {},
      authHeaders: {},
      allowedOrigin: "https://api.example.test",
      signal: abortController.signal,
      timeoutMs: 100,
      transport: (request) =>
        new Promise((_resolve, reject) => {
          request.init.signal?.addEventListener(
            "abort",
            () => reject(request.init.signal?.reason),
            { once: true },
          );
        }),
    });
    abortController.abort(new Error(SECRET));

    const error = await assertRejects(() => pending, VeryfrontError);
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "local-integration-request-failed");
    assertEquals(error.message.includes(SECRET), false);
    assertEquals(error.cause, undefined);

    const timeoutError = await assertRejects(
      () =>
        executeLocalIntegrationEndpoint({
          endpoint: endpoint({
            method: "GET",
            url: "https://api.example.test/slow",
          }),
          args: {},
          authHeaders: {},
          allowedOrigin: "https://api.example.test",
          timeoutMs: 5,
          transport: (request) =>
            new Promise((_resolve, reject) => {
              request.init.signal?.addEventListener(
                "abort",
                () => reject(request.init.signal?.reason),
                { once: true },
              );
            }),
        }),
      VeryfrontError,
    );
    assertInstanceOf(timeoutError, VeryfrontError);
    assertEquals(timeoutError.slug, "local-integration-request-failed");
    assertEquals(timeoutError.cause, undefined);
  });
});
