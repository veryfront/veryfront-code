import "#veryfront/schemas/_test-setup.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateMCPToolsFromSpec } from "./mcp-tools.ts";
import type { OpenAPIPathItem, OpenAPISpec } from "./types.ts";

function makeSpec(paths: OpenAPISpec["paths"]): OpenAPISpec {
  return {
    openapi: "3.1.0",
    info: { title: "Test API", version: "1.0.0" },
    paths,
  };
}

function generateTools(
  spec: OpenAPISpec,
  options?: { baseUrl: string; toolPrefix?: string },
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
        // Path-item fields that are not operations: OpenAPIPathItem does not
        // declare them, so the cast is what a real spec would hand us.
        "/api/users": {
          get: {
            operationId: "getUsers",
            responses: { "200": { description: "OK" } },
          },
          parameters: [],
          summary: "Users",
          servers: [],
          $ref: "#/components/pathItems/x",
        } as unknown as OpenAPIPathItem,
      });

      const tools = generateTools(spec, { baseUrl: "http://localhost:3000" });
      assertEquals(tools.length, 1, "only HTTP method entries become tools");
      assertEquals(
        tools[0]?.id,
        "api:getUsers",
        "the single tool must come from the get operation, not a path-item field",
      );
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
      let requestHeaders: Headers | undefined;

      try {
        installMockFetch((input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          requestHeaders = request.headers;
          return Promise.resolve(
            Response.json({ ok: true }, { status: 200 }),
          );
        });

        const tools = generateTools(
          makeSpec({
            "/api/users": {
              get: {
                operationId: "getUsers",
                responses: { "200": { description: "OK" } },
              },
            },
          }),
          { baseUrl: "http://93.184.216.34:3000" },
        );

        const first = tools[0];
        assertExists(first);
        await first.execute({}, { endUserId: "user-123" });

        assertExists(requestHeaders);
        assertEquals(requestHeaders.get("X-End-User-Id"), null);
      } finally {
        restoreMockFetch();
      }
    });

    it("percent-encodes path parameters and appends query parameters", async () => {
      let requestUrl: string | undefined;

      try {
        installMockFetch((input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          requestUrl = request.url;
          return Promise.resolve(Response.json({ ok: true }, { status: 200 }));
        });

        const tools = generateTools(
          makeSpec({
            "/api/users/{id}": {
              get: {
                operationId: "getUser",
                parameters: [
                  { name: "id", in: "path", required: true, schema: { type: "string" } },
                  { name: "limit", in: "query", schema: { type: "integer" } },
                ],
                responses: { "200": { description: "OK" } },
              },
            },
          }),
          { baseUrl: "http://93.184.216.34:3000" },
        );

        const first = tools[0];
        assertExists(first);
        await first.execute({ id: "a/b", query: { limit: 5 } });

        assertEquals(
          requestUrl,
          "http://93.184.216.34:3000/api/users/a%2Fb?limit=5",
          "path params must be percent-encoded and query params appended",
        );
      } finally {
        restoreMockFetch();
      }
    });

    it("fails closed on a response larger than the size cap", async () => {
      try {
        installMockFetch(() =>
          Promise.resolve(
            new Response("a".repeat(4 * 1024 * 1024 + 16), {
              status: 200,
              headers: { "content-type": "text/plain" },
            }),
          )
        );

        const tools = generateTools(
          makeSpec({
            "/api/users": {
              get: {
                operationId: "getUsers",
                responses: { "200": { description: "OK" } },
              },
            },
          }),
          { baseUrl: "http://93.184.216.34:3000" },
        );

        const first = tools[0];
        assertExists(first);
        const result = await first.execute({});

        assertEquals(
          (result as { error?: boolean }).error,
          true,
          "oversize responses must fail closed",
        );
        assertStringIncludes(
          (result as { message: string }).message,
          "exceeds the maximum allowed size",
          "the cap must be the reported reason",
        );
      } finally {
        restoreMockFetch();
      }
    });

    it("parses a JSON response and passes other content types through as text", async () => {
      const spec = makeSpec({
        "/api/users": {
          get: {
            operationId: "getUsers",
            responses: { "200": { description: "OK" } },
          },
        },
      });

      try {
        installMockFetch(() => Promise.resolve(Response.json({ ok: true }, { status: 200 })));

        const jsonTool = generateTools(spec, { baseUrl: "http://93.184.216.34:3000" })[0];
        assertExists(jsonTool);
        const jsonResult = await jsonTool.execute({});
        assertEquals(
          (jsonResult as { data?: unknown }).data,
          { ok: true },
          "an application/json response is parsed into data",
        );
      } finally {
        restoreMockFetch();
      }

      try {
        installMockFetch(() =>
          Promise.resolve(
            new Response("plain body", {
              status: 200,
              headers: { "content-type": "text/plain" },
            }),
          )
        );

        const textTool = generateTools(spec, { baseUrl: "http://93.184.216.34:3000" })[0];
        assertExists(textTool);
        const textResult = await textTool.execute({});
        assertEquals(
          (textResult as { data?: unknown }).data,
          "plain body",
          "a non-JSON response reaches data as raw text",
        );
      } finally {
        restoreMockFetch();
      }
    });

    it("blocks an internal configured API base URL before invoking fetch", async () => {
      let fetchCalls = 0;
      installMockFetch(
        (() => {
          fetchCalls++;
          return Promise.resolve(Response.json({ unexpected: true }));
        }) as typeof fetch,
      );

      try {
        const tools = generateTools(
          makeSpec({
            "/api/users": {
              get: {
                operationId: "getUsers",
                responses: { "200": { description: "OK" } },
              },
            },
          }),
          { baseUrl: "http://169.254.169.254" },
        );
        const first = tools[0];
        assertExists(first);

        const result = await first.execute({});
        assertEquals(fetchCalls, 0);
        assertEquals((result as { error?: boolean }).error, true);
      } finally {
        restoreMockFetch();
      }
    });
  });
});
