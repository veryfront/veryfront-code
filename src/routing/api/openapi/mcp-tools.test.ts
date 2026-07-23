import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateMCPToolsFromSpec } from "./mcp-tools.ts";
import type { OpenAPISpec } from "./types.ts";

function makeSpec(paths: OpenAPISpec["paths"]): OpenAPISpec {
  return {
    openapi: "3.1.0",
    info: { title: "Test API", version: "1.0.0" },
    paths,
  };
}

function generateTools(
  spec: OpenAPISpec,
  options?: {
    baseUrl: string;
    toolPrefix?: string;
    headers?: Record<string, string>;
    maxResponseBytes?: number;
  },
) {
  return generateMCPToolsFromSpec(spec, options ?? { baseUrl: "http://localhost:3000" });
}

describe("routing/api/openapi/mcp-tools", () => {
  describe("generateMCPToolsFromSpec()", () => {
    it("should generate tools for each operation", () => {
      const spec = makeSpec({
        "/api/users": {
          get: {
            operationId: "getUsers",
            summary: "List users",
            responses: { "200": { description: "OK" } },
          },
          post: {
            operationId: "createUser",
            summary: "Create user",
            responses: { "201": { description: "Created" } },
          },
        },
      });

      const tools = generateTools(spec, { baseUrl: "http://localhost:3000" });
      assertEquals(tools.length, 2);
    });

    it("should use default tool prefix 'api'", () => {
      const spec = makeSpec({
        "/api/items": {
          get: {
            operationId: "getItems",
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateTools(spec, { baseUrl: "http://localhost:3000" });

      const first = tools[0];
      assertExists(first);
      assertEquals(first.id, "api:getItems");
    });

    it("should use custom tool prefix", () => {
      const spec = makeSpec({
        "/api/items": {
          get: {
            operationId: "getItems",
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateTools(spec, {
        baseUrl: "http://localhost:3000",
        toolPrefix: "myapp",
      });

      const first = tools[0];
      assertExists(first);
      assertEquals(first.id, "myapp:getItems");
    });

    it("derives a stable operation id when the spec omits one", () => {
      const tools = generateTools(makeSpec({
        "/api/items/{id}": {
          get: { responses: { "200": { description: "OK" } } },
        },
      }));

      assertEquals(tools[0]?.id, "api:getItemsById");
    });

    it("rejects duplicate operation ids before registering tools", () => {
      const spec = makeSpec({
        "/api/a": {
          get: { operationId: "duplicate", responses: { "200": { description: "OK" } } },
        },
        "/api/b": {
          get: { operationId: "duplicate", responses: { "200": { description: "OK" } } },
        },
      });

      let message = "";
      try {
        generateTools(spec);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assertEquals(message.includes("Duplicate OpenAPI operation id"), true);
    });

    it("should return empty array for empty paths", () => {
      const spec = makeSpec({});
      const tools = generateTools(spec, { baseUrl: "http://localhost:3000" });
      assertEquals(tools.length, 0);
    });

    it("should skip non-HTTP method entries", () => {
      const spec = makeSpec({
        "/api/users": {
          get: {
            operationId: "getUsers",
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateTools(spec, { baseUrl: "http://localhost:3000" });
      assertEquals(tools.length, 1);
    });

    it("should handle all HTTP methods", () => {
      const spec = makeSpec({
        "/api/resource": {
          get: {
            operationId: "getResource",
            responses: { "200": { description: "OK" } },
          },
          post: {
            operationId: "createResource",
            responses: { "201": { description: "Created" } },
          },
          put: {
            operationId: "updateResource",
            responses: { "200": { description: "OK" } },
          },
          patch: {
            operationId: "patchResource",
            responses: { "200": { description: "OK" } },
          },
          delete: {
            operationId: "deleteResource",
            responses: { "204": { description: "Deleted" } },
          },
          head: {
            operationId: "headResource",
            responses: { "200": { description: "OK" } },
          },
          options: {
            operationId: "optionsResource",
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateTools(spec, { baseUrl: "http://localhost:3000" });
      assertEquals(tools.length, 7);
    });

    it("should include description with summary", () => {
      const spec = makeSpec({
        "/api/users": {
          get: {
            operationId: "getUsers",
            summary: "List all users",
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateTools(spec, { baseUrl: "http://localhost:3000" });

      const first = tools[0];
      assertExists(first);
      assertEquals(first.description.includes("List all users"), true);
    });

    it("should handle operations with tags in description", () => {
      const spec = makeSpec({
        "/api/users": {
          get: {
            operationId: "getUsers",
            summary: "List users",
            tags: ["users", "admin"],
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateTools(spec, { baseUrl: "http://localhost:3000" });

      const first = tools[0];
      assertExists(first);
      assertEquals(first.description.includes("Tags: users, admin"), true);
    });

    it("should handle deprecated operations", () => {
      const spec = makeSpec({
        "/api/old": {
          get: {
            operationId: "getOld",
            summary: "Old endpoint",
            deprecated: true,
            responses: { "200": { description: "OK" } },
          },
        },
      });

      const tools = generateTools(spec, { baseUrl: "http://localhost:3000" });

      const first = tools[0];
      assertExists(first);
      assertEquals(first.description.includes("DEPRECATED"), true);
    });

    it("should skip null path items", () => {
      const spec = makeSpec({
        "/api/users": null as unknown as OpenAPISpec["paths"][string],
      });

      const tools = generateTools(spec, { baseUrl: "http://localhost:3000" });
      assertEquals(tools.length, 0);
    });

    it("should generate tools for multiple paths", () => {
      const spec = makeSpec({
        "/api/users": {
          get: {
            operationId: "getUsers",
            responses: { "200": { description: "OK" } },
          },
        },
        "/api/posts": {
          get: {
            operationId: "getPosts",
            responses: { "200": { description: "OK" } },
          },
          post: {
            operationId: "createPost",
            responses: { "201": { description: "Created" } },
          },
        },
      });

      const tools = generateTools(spec, { baseUrl: "http://localhost:3000" });

      assertEquals(tools.length, 3);

      const ids = tools.map((t) => t.id);
      assertEquals(ids.includes("api:getUsers"), true);
      assertEquals(ids.includes("api:getPosts"), true);
      assertEquals(ids.includes("api:createPost"), true);
    });

    it("does not propagate caller-supplied end-user identity headers", async () => {
      const originalFetch = globalThis.fetch;
      let requestHeaders: Headers | undefined;

      try {
        globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          requestHeaders = request.headers;
          return Promise.resolve(
            Response.json({ ok: true }, { status: 200 }),
          );
        };

        const tools = generateTools(
          makeSpec({
            "/api/users": {
              get: {
                operationId: "getUsers",
                responses: { "200": { description: "OK" } },
              },
            },
          }),
          { baseUrl: "http://localhost:3000" },
        );

        const first = tools[0];
        assertExists(first);
        await first.execute({}, { endUserId: "user-123" });

        assertExists(requestHeaders);
        assertEquals(requestHeaders.get("X-End-User-Id"), null);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not let tool input override configured authentication headers", async () => {
      const originalFetch = globalThis.fetch;
      let requestHeaders: Headers | undefined;
      try {
        globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          requestHeaders = request.headers;
          return Promise.resolve(Response.json({ ok: true }));
        };
        const tools = generateTools(
          makeSpec({
            "/api/users": {
              get: {
                operationId: "getUsers",
                parameters: [{
                  name: "authorization",
                  in: "header",
                  schema: { type: "string" },
                }],
                responses: { "200": { description: "OK" } },
              },
            },
          }),
          {
            baseUrl: "http://localhost:3000",
            headers: { authorization: "Bearer trusted" },
          },
        );

        await tools[0]!.execute({ headers: { authorization: "Bearer untrusted" } });

        assertEquals(requestHeaders?.get("authorization"), "Bearer trusted");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("serializes array query parameters as repeated keys", async () => {
      const originalFetch = globalThis.fetch;
      let requestUrl = "";
      try {
        globalThis.fetch = (async (input) => {
          requestUrl = String(input);
          return Response.json({ ok: true });
        }) as typeof fetch;
        const tools = generateTools(makeSpec({
          "/api/search": {
            get: {
              operationId: "search",
              parameters: [{
                name: "tag",
                in: "query",
                schema: { type: "array", items: { type: "string" } },
              }],
              responses: { "200": { description: "OK" } },
            },
          },
        }));

        await tools[0]!.execute({ query: { tag: ["one", "two"] } });

        assertEquals(new URL(requestUrl).searchParams.getAll("tag"), ["one", "two"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("rejects calls with unresolved required path parameters before fetch", async () => {
      const originalFetch = globalThis.fetch;
      let fetched = false;
      try {
        globalThis.fetch = (() => {
          fetched = true;
          return Promise.resolve(Response.json({ ok: true }));
        }) as typeof fetch;
        const tools = generateTools(makeSpec({
          "/api/users/{id}": {
            get: {
              operationId: "getUser",
              parameters: [{
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              }],
              responses: { "200": { description: "OK" } },
            },
          },
        }));

        await assertRejects(() => tools[0]!.execute({}));
        assertEquals(fetched, false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("cancels and rejects oversized API responses", async () => {
      const originalFetch = globalThis.fetch;
      let cancelled = false;
      try {
        globalThis.fetch = (async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(new Uint8Array(8));
              },
              cancel() {
                cancelled = true;
              },
            }),
          )) as typeof fetch;
        const tools = generateTools(
          makeSpec({
            "/api/data": {
              get: {
                operationId: "getData",
                responses: { "200": { description: "OK" } },
              },
            },
          }),
          { baseUrl: "http://localhost:3000", maxResponseBytes: 16 },
        );

        const result = await tools[0]!.execute({}) as { error?: boolean; message?: string };

        assertEquals(result.error, true);
        assertEquals(result.message, "API response exceeded the configured size limit");
        assertEquals(cancelled, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
