import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { IntegrationToolMeta } from "./schema.ts";
import {
  executeLocalIntegrationEndpoint as executeEndpoint,
  type ExecuteLocalIntegrationEndpointOptions,
  type LocalIntegrationEndpointTransport,
  type LocalIntegrationEndpointTransportRequest,
  snapshotLocalIntegrationEndpointArguments,
} from "./local-endpoint-executor.ts";

type IntegrationEndpoint = NonNullable<IntegrationToolMeta["endpoint"]>;

const SECRET = "LOCAL_ENDPOINT_SECRET_MUST_NOT_LEAK";
const defineProperty = Object.defineProperty;
const deleteProperty = Reflect.deleteProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function appendRestorer(restorers: Array<() => void>, restorer: () => void): void {
  defineProperty(restorers, restorers.length, {
    configurable: true,
    enumerable: true,
    value: restorer,
    writable: true,
  });
}

function replaceProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): () => void {
  const descriptor = getOwnPropertyDescriptor(target, key);
  defineProperty(target, key, {
    configurable: true,
    value,
    writable: true,
  });
  return () => {
    if (descriptor) defineProperty(target, key, descriptor);
    else deleteProperty(target, key);
  };
}

function endpoint(value: IntegrationEndpoint): IntegrationEndpoint {
  return value;
}

function executeLocalIntegrationEndpoint(
  options:
    & Omit<ExecuteLocalIntegrationEndpointOptions, "connectorName" | "toolId">
    & Partial<Pick<ExecuteLocalIntegrationEndpointOptions, "connectorName" | "toolId">>,
): Promise<unknown> {
  return executeEndpoint({
    ...options,
    connectorName: options.connectorName ?? "example",
    toolId: options.toolId ?? "example__test",
  });
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

  it("returns null for a successful response with no representation", async () => {
    const result = await executeLocalIntegrationEndpoint({
      endpoint: endpoint({
        method: "POST",
        url: "https://api.example.test/items/item-1/pause",
      }),
      args: {},
      authHeaders: {},
      allowedOrigin: "https://api.example.test",
      transport: () => Promise.resolve(new Response(null, { status: 204 })),
    });

    assertEquals(result, null);
  });

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

  it("constructs admitted requests without ambient collection traversal", async () => {
    const restorers: Array<() => void> = [];
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("ambient endpoint primordial used");
    };
    let request: LocalIntegrationEndpointTransportRequest | undefined;
    let failure: unknown;

    try {
      appendRestorer(restorers, replaceProperty(Array, "isArray", poison));
      appendRestorer(restorers, replaceProperty(Array.prototype, Symbol.iterator, poison));
      appendRestorer(restorers, replaceProperty(globalThis, "AbortController", poison));
      appendRestorer(restorers, replaceProperty(globalThis, "clearTimeout", poison));
      appendRestorer(restorers, replaceProperty(globalThis, "encodeURIComponent", poison));
      appendRestorer(restorers, replaceProperty(globalThis, "Headers", poison));
      appendRestorer(restorers, replaceProperty(JSON, "parse", poison));
      appendRestorer(restorers, replaceProperty(JSON, "stringify", poison));
      appendRestorer(restorers, replaceProperty(Number, "isFinite", poison));
      appendRestorer(restorers, replaceProperty(Number, "isSafeInteger", poison));
      appendRestorer(restorers, replaceProperty(Object, "create", poison));
      appendRestorer(restorers, replaceProperty(Object, "defineProperty", poison));
      appendRestorer(restorers, replaceProperty(Object, "freeze", poison));
      appendRestorer(restorers, replaceProperty(Object, "keys", poison));
      appendRestorer(restorers, replaceProperty(Reflect, "getOwnPropertyDescriptor", poison));
      // Node's native Headers implementation reads String, charCodeAt, and
      // includes from the host realm inside Headers.prototype.set. Poisoning
      // those makes the captured host constructor itself unusable, so this
      // test limits its assertion to framework-owned traversal.
      appendRestorer(restorers, replaceProperty(String.prototype, "replaceAll", poison));
      appendRestorer(restorers, replaceProperty(String.prototype, "slice", poison));
      appendRestorer(restorers, replaceProperty(globalThis, "setTimeout", poison));
      appendRestorer(restorers, replaceProperty(globalThis, "URL", poison));

      try {
        await executeLocalIntegrationEndpoint({
          endpoint: endpoint({
            method: "POST",
            url: "https://api.example.test/items",
            params: {
              limit: {
                type: "number",
                in: "query",
                description: "Page size",
                required: true,
              },
            },
            body: {
              label: {
                type: "string",
                description: "Label",
                required: true,
              },
            },
          }),
          args: { limit: 2, label: "two" },
          authHeaders: { Authorization: `Bearer ${SECRET}` },
          allowedOrigin: "https://api.example.test",
          transport: (nextRequest) => {
            request = nextRequest;
            throw new Error("stop after request construction");
          },
        });
      } catch (error) {
        failure = error;
      }
    } finally {
      for (let index = restorers.length - 1; index >= 0; index--) restorers[index]?.();
    }

    assertEquals(poisonCalls, 0);
    assertInstanceOf(failure, VeryfrontError);
    assertEquals(failure.slug, "local-integration-request-failed");
    assert(request);
    assertEquals(request.url.href, "https://api.example.test/items?limit=2");
    assertEquals(request.init.body, '{"label":"two"}');
    assertEquals(new Headers(request.init.headers).get("authorization"), `Bearer ${SECRET}`);
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

  it("cleans up rejected provider bodies through captured stream primordials", async () => {
    const response = new Response("provider failure", { status: 500 });
    const restorers: Array<() => void> = [];
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("ambient cleanup primordial used");
    };
    let failure: unknown;

    try {
      appendRestorer(restorers, replaceProperty(Promise.prototype, "catch", poison));
      appendRestorer(restorers, replaceProperty(ReadableStream.prototype, "cancel", poison));
      try {
        await executeLocalIntegrationEndpoint({
          endpoint: endpoint({
            method: "GET",
            url: "https://api.example.test/items",
          }),
          args: {},
          authHeaders: {},
          allowedOrigin: "https://api.example.test",
          transport: () => Promise.resolve(response),
        });
      } catch (error) {
        failure = error;
      }
    } finally {
      for (let index = restorers.length - 1; index >= 0; index--) restorers[index]?.();
    }

    assertEquals(poisonCalls, 0);
    assertInstanceOf(failure, VeryfrontError);
    assertEquals(failure.slug, "local-integration-request-failed");
    assertEquals(response.bodyUsed, true);
  });

  it("bounds responses and never exposes provider bodies, URLs, headers, or causes", async () => {
    const fixtures = [
      { response: () => new Response(SECRET, { status: 500 }), status: 500 },
      { response: () => new Response(`{"secret":"${SECRET}"`, { status: 200 }), status: 200 },
      {
        response: () =>
          new Response("{}", {
            headers: { "content-length": String(4 * 1024 * 1024 + 1) },
          }),
        status: 200,
      },
    ];

    for (const fixture of fixtures) {
      const error = await assertRejects(
        () =>
          executeLocalIntegrationEndpoint({
            connectorName: "example",
            toolId: "example__list_items",
            endpoint: endpoint({
              method: "GET",
              url: `https://api.example.test/items?credential=${SECRET}`,
            }),
            args: {},
            authHeaders: { Authorization: `Bearer ${SECRET}` },
            allowedOrigin: "https://api.example.test",
            transport: () => Promise.resolve(fixture.response()),
          }),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assert(
        error.slug === "local-integration-request-failed" ||
          error.slug === "local-integration-response-invalid",
      );
      assert(error.message.includes('integration "example"'), error.message);
      assert(error.message.includes('tool "example__list_items"'), error.message);
      assert(error.message.includes(`HTTP status ${fixture.status}`), error.message);
      assertEquals(error.message.includes(SECRET), false);
      assertEquals(error.message.includes("api.example.test"), false);
      assertEquals(error.cause, undefined);
    }
  });

  it("rejects a path argument that is a dot segment", async () => {
    const attempts: string[] = [];
    const transport: LocalIntegrationEndpointTransport = (request) => {
      attempts.push(request.url.href);
      return Promise.resolve(Response.json({}));
    };

    for (const traversal of ["..", ".", ""]) {
      const error = await assertRejects(
        () =>
          executeLocalIntegrationEndpoint({
            endpoint: endpoint({
              method: "GET",
              url: "https://api.example.test/repos/{owner}/{repo}/issues",
              params: {
                owner: { type: "string", in: "path", description: "Owner", required: true },
                repo: { type: "string", in: "path", description: "Repo", required: true },
              },
            }),
            args: { owner: traversal, repo: traversal },
            authHeaders: { Authorization: `Bearer ${SECRET}` },
            allowedOrigin: "https://api.example.test",
            transport,
          }),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-request-invalid");
      assertEquals(error.message.includes(SECRET), false);
    }

    assertEquals(attempts, []);
  });

  it("keeps a granted endpoint path pinned when a path argument only contains dots", async () => {
    const requests: string[] = [];
    const transport: LocalIntegrationEndpointTransport = (request) => {
      requests.push(request.url.href);
      return Promise.resolve(Response.json({}));
    };

    await executeLocalIntegrationEndpoint({
      endpoint: endpoint({
        method: "GET",
        url: "https://api.example.test/repos/{owner}/{repo}/issues",
        params: {
          owner: { type: "string", in: "path", description: "Owner", required: true },
          repo: { type: "string", in: "path", description: "Repo", required: true },
        },
      }),
      args: { owner: "...", repo: "%2e%2e" },
      authHeaders: {},
      allowedOrigin: "https://api.example.test",
      transport,
    });

    assertEquals(requests, ["https://api.example.test/repos/.../%252e%252e/issues"]);
  });

  it("rejects an endpoint whose built URL leaves the admitted origin", async () => {
    const attempts: string[] = [];
    const transport: LocalIntegrationEndpointTransport = (request) => {
      attempts.push(request.url.href);
      return Promise.resolve(Response.json({}));
    };

    const error = await assertRejects(
      () =>
        executeLocalIntegrationEndpoint({
          endpoint: endpoint({
            method: "GET",
            url: "https://api.example.test/items",
          }),
          args: {},
          authHeaders: { Authorization: `Bearer ${SECRET}` },
          allowedOrigin: "https://other.example.test",
          transport,
        }),
      VeryfrontError,
    );

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "local-integration-request-invalid");
    assertEquals(error.message.includes(SECRET), false);
    assertEquals(attempts, []);
  });

  it("rejects an assembled body that only exceeds the JSON bound once defaults apply", () => {
    // A body field left unsupplied still contributes its catalog default to the
    // assembled request. Validating each field on its own therefore proves
    // nothing about the size of the body they add up to.
    const bodyEndpoint = endpoint({
      method: "POST",
      url: "https://api.example.test/v1/records",
      body: {
        a: { type: "string", description: "A", required: true },
        b: { type: "string", description: "B", required: true },
        c: { type: "string", description: "C", required: true },
        d: { type: "string", description: "D", required: true },
        padded: { type: "string", description: "Padded", default: "default-value" },
      },
    });

    const maxSerializedBytes = 4 * 1024 * 1024;
    // Four strings just under the 1 MiB per-string cap, sized so the supplied
    // arguments land a few bytes under the 4 MiB serialized cap and the single
    // defaulted field is what carries them over it.
    const chunk = "x".repeat(1024 * 1024 - 8);
    const supplied = { a: chunk, b: chunk, c: chunk, d: chunk };
    const suppliedBytes = new TextEncoder().encode(JSON.stringify(supplied)).length;
    const assembled = { ...supplied, padded: "default-value" };
    const assembledBytes = new TextEncoder().encode(JSON.stringify(assembled)).length;

    // The premise: supplied arguments fit, the assembled body does not.
    assert(suppliedBytes <= maxSerializedBytes, `supplied ${suppliedBytes}`);
    assert(assembledBytes > maxSerializedBytes, `assembled ${assembledBytes}`);

    const error = assertThrows(
      () => snapshotLocalIntegrationEndpointArguments(bodyEndpoint, supplied),
      VeryfrontError,
    );

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "local-integration-request-invalid");
  });

  it("cancels a response rejected by its declared size", async () => {
    const response = new Response("{}", {
      headers: { "content-length": String(4 * 1024 * 1024 + 1) },
    });

    const error = await assertRejects(
      () =>
        executeLocalIntegrationEndpoint({
          endpoint: endpoint({
            method: "GET",
            url: "https://api.example.test/items",
          }),
          args: {},
          authHeaders: {},
          allowedOrigin: "https://api.example.test",
          transport: () => Promise.resolve(response),
        }),
      VeryfrontError,
    );

    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "local-integration-response-invalid");
    assertEquals(response.bodyUsed, true);
  });

  it("enforces its deadline and propagates caller cancellation", async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException("caller stopped", "AbortError");
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
    abortController.abort(abortReason);

    assertStrictEquals(await assertRejects(() => pending), abortReason);

    const preAbortedController = new AbortController();
    const preAbortedReason = new DOMException("already stopped", "AbortError");
    preAbortedController.abort(preAbortedReason);
    let transportCalls = 0;
    const preAbortedError = await assertRejects(() =>
      executeLocalIntegrationEndpoint({
        endpoint: endpoint({
          method: "GET",
          url: "https://api.example.test/slow",
        }),
        args: {},
        authHeaders: {},
        allowedOrigin: "https://api.example.test",
        signal: preAbortedController.signal,
        transport: () => {
          transportCalls += 1;
          return Promise.resolve(Response.json({ unexpected: true }));
        },
      })
    );
    assertStrictEquals(preAbortedError, preAbortedReason);
    assertEquals(transportCalls, 0);

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
