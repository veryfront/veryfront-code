import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
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
  options?: Parameters<typeof generateMCPToolsFromSpec>[1],
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

    it("captures the specification and rejects duplicate generated tool IDs", () => {
      const operation = {
        operationId: "listItems",
        summary: "Original summary",
        responses: { "200": { description: "OK" } },
      };
      const spec = makeSpec({ "/api/items": { get: operation } });
      const [tool] = generateTools(spec);
      assertExists(tool);

      operation.summary = "Mutated summary";
      assertEquals(tool.description.includes("Original summary"), true);
      assertEquals(tool.description.includes("Mutated summary"), false);

      assertThrows(
        () =>
          generateTools(makeSpec({
            "/api/one": { get: operation },
            "/api/two": { get: { ...operation } },
          })),
        TypeError,
        "duplicate",
      );
    });

    it("keeps configured headers authoritative and rejects redirects", async () => {
      let request: Request | undefined;
      let redirect: RequestRedirect | undefined;
      const [tool] = generateTools(
        makeSpec({
          "/api/items": {
            post: {
              operationId: "createItem",
              parameters: [{
                name: "Authorization",
                in: "header",
                required: false,
                schema: { type: "string" },
              }],
              requestBody: {
                content: { "application/json": { schema: { type: "object" } } },
              },
              responses: { "200": { description: "OK" } },
            },
          },
        }),
        {
          baseUrl: "https://api.example.test/root",
          headers: { Authorization: "Bearer configured" },
          fetch(input, init) {
            request = new Request(input, init);
            redirect = init?.redirect;
            return Promise.resolve(Response.json({ ok: true }));
          },
        },
      );
      assertExists(tool);

      await tool.execute({
        headers: { Authorization: "Bearer caller" },
        body: { name: "item" },
      });

      assertExists(request);
      assertEquals(request.url, "https://api.example.test/root/api/items");
      assertEquals(request.headers.get("authorization"), "Bearer configured");
      assertEquals(request.headers.get("content-type"), "application/json");
      assertEquals(redirect, "error");
    });

    it("links request cancellation to the execution context", async () => {
      const caller = new AbortController();
      const cancellationReason = new Error("caller stopped");
      let requestSignal: AbortSignal | undefined;
      const [tool] = generateTools(
        makeSpec({
          "/api/wait": {
            get: {
              operationId: "wait",
              responses: { "200": { description: "OK" } },
            },
          },
        }),
        {
          baseUrl: "https://api.example.test",
          fetch(_input, init) {
            requestSignal = init?.signal ?? undefined;
            return new Promise<Response>(() => {});
          },
        },
      );
      assertExists(tool);

      const execution = tool.execute({}, { abortSignal: caller.signal });
      caller.abort(cancellationReason);

      await assertRejects(() => execution, Error, "caller stopped");
      assertExists(requestSignal);
      assertEquals(requestSignal.aborted, true);
      assertStrictEquals(requestSignal.reason, cancellationReason);
    });

    it("enforces its deadline when a fetch implementation ignores abort", async () => {
      const [tool] = generateTools(
        makeSpec({
          "/api/wait": {
            get: {
              operationId: "waitWithTimeout",
              responses: { "200": { description: "OK" } },
            },
          },
        }),
        {
          baseUrl: "https://api.example.test",
          timeoutMs: 10,
          fetch: () => new Promise<Response>(() => {}),
        },
      );
      assertExists(tool);

      await assertRejects(() => tool.execute({}), Error, "timed out");
    });

    it("rejects oversized and malformed JSON response bodies", async () => {
      for (
        const response of [
          new Response("x".repeat(65), {
            headers: { "content-type": "text/plain" },
          }),
          new Response(new Uint8Array([0xff]), {
            headers: { "content-type": "application/json" },
          }),
        ]
      ) {
        const [tool] = generateTools(
          makeSpec({
            "/api/data": {
              get: {
                operationId: "getData",
                responses: { "200": { description: "OK" } },
              },
            },
          }),
          {
            baseUrl: "https://api.example.test",
            maxResponseBytes: 64,
            fetch: () => Promise.resolve(response),
          },
        );
        assertExists(tool);
        await assertRejects(() => tool.execute({}), TypeError);
      }
    });
  });
});
