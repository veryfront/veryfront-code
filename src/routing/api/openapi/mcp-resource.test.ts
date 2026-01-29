import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createOpenAPIResource } from "./mcp-resource.ts";
import type { OpenAPISpec } from "./types.ts";

function makeSpec(overrides: Partial<OpenAPISpec> = {}): OpenAPISpec {
  return {
    openapi: "3.1.0",
    info: { title: "Test API", version: "1.0.0" },
    paths: {},
    tags: [],
    ...overrides,
  };
}

describe("routing/api/openapi/mcp-resource", () => {
  describe("createOpenAPIResource()", () => {
    it("should create a resource object", () => {
      const resource = createOpenAPIResource(() => Promise.resolve(makeSpec()));
      assertEquals(resource != null, true);
    });

    it("should return resource with correct pattern", () => {
      const resource = createOpenAPIResource(() => Promise.resolve(makeSpec()));
      assertEquals(resource.pattern, "openapi://spec");
    });

    it("should return resource with description", () => {
      const resource = createOpenAPIResource(() => Promise.resolve(makeSpec()));
      assertEquals(typeof resource.description, "string");
      assertEquals(resource.description.length > 0, true);
    });

    it("should load spec data with summary", async () => {
      const spec = makeSpec({
        info: { title: "My API", version: "2.0.0" },
        paths: {
          "/api/users": {
            get: {
              summary: "Get users",
              responses: { "200": { description: "OK" } },
            },
          },
        },
        tags: [{ name: "users" }],
      });

      const resource = createOpenAPIResource(() => Promise.resolve(spec));
      const result = await resource.load({});

      assertEquals(result.spec, spec);
      assertEquals(result.summary.title, "My API");
      assertEquals(result.summary.version, "2.0.0");
      assertEquals(result.summary.endpoints, 1);
      assertEquals(result.summary.tags, ["users"]);
    });

    it("should handle spec with no tags", async () => {
      const spec = makeSpec({ tags: undefined });
      const resource = createOpenAPIResource(() => Promise.resolve(spec));
      const result = await resource.load({});

      assertEquals(result.summary.tags, []);
    });

    it("should handle spec with empty paths", async () => {
      const spec = makeSpec({ paths: {} });
      const resource = createOpenAPIResource(() => Promise.resolve(spec));
      const result = await resource.load({});

      assertEquals(result.summary.endpoints, 0);
    });

    it("should handle spec with multiple paths", async () => {
      const spec = makeSpec({
        paths: {
          "/api/users": { get: { responses: { "200": { description: "OK" } } } },
          "/api/posts": { get: { responses: { "200": { description: "OK" } } } },
          "/api/comments": { get: { responses: { "200": { description: "OK" } } } },
        },
      });

      const resource = createOpenAPIResource(() => Promise.resolve(spec));
      const result = await resource.load({});

      assertEquals(result.summary.endpoints, 3);
    });

    it("should have MCP config enabled", () => {
      const resource = createOpenAPIResource(() => Promise.resolve(makeSpec()));
      assertEquals(resource.mcp?.enabled, true);
    });
  });
});
