import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { specToYaml } from "./spec-generator.ts";
import type { OpenAPISpec } from "./types.ts";

function assertIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), true);
}

function assertNotIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), false);
}

describe("routing/api/openapi/spec-generator", () => {
  describe("specToYaml()", () => {
    it("should convert a minimal spec to YAML", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: {
          title: "Test API",
          version: "1.0.0",
        },
        paths: {},
      };

      const yaml = specToYaml(spec);
      assertIncludes(yaml, "openapi: 3.1.0");
      assertIncludes(yaml, "title: Test API");
      assertIncludes(yaml, "version: 1.0.0");
      assertIncludes(yaml, "paths:{}");
    });

    it("should handle spec with description", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: {
          title: "My API",
          version: "2.0.0",
          description: "A test API",
        },
        paths: {},
      };

      const yaml = specToYaml(spec);
      assertIncludes(yaml, "description: A test API");
    });

    it("should handle spec with tags", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {},
        tags: [{ name: "users" }, { name: "posts" }],
      };

      const yaml = specToYaml(spec);
      assertIncludes(yaml, "- name: users");
      assertIncludes(yaml, "- name: posts");
    });

    it("should handle spec with servers", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {},
        servers: [{ url: "https://api.example.com", description: "Production" }],
      };

      const yaml = specToYaml(spec);
      assertIncludes(yaml, "servers:");
    });

    it("should handle paths with operations", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {
          "/api/users": {
            get: {
              summary: "List users",
              responses: { "200": { description: "Success" } },
            },
          },
        },
      };

      const yaml = specToYaml(spec);
      assertIncludes(yaml, "summary: List users");
    });

    it("should handle empty arrays as []", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {},
        tags: [],
      };

      const yaml = specToYaml(spec);
      assertIncludes(yaml, "tags: []");
    });

    it("should handle null values", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0", description: undefined },
        paths: {},
      };

      const yaml = specToYaml(spec);
      assertNotIncludes(yaml, "description");
    });

    it("should quote strings containing colons", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {
          "/api/users": {
            get: {
              summary: "key: value pair",
              responses: { "200": { description: "OK" } },
            },
          },
        },
      };

      const yaml = specToYaml(spec);
      assertIncludes(yaml, '"key: value pair"');
    });

    it("should handle boolean values", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {
          "/api/items": {
            get: {
              deprecated: true,
              responses: { "200": { description: "OK" } },
            },
          },
        },
      };

      const yaml = specToYaml(spec);
      assertIncludes(yaml, "deprecated: true");
    });

    it("should handle number values", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {
          "/api/items": {
            get: {
              parameters: [
                {
                  name: "limit",
                  in: "query",
                  schema: { type: "integer" as const },
                },
              ],
              responses: { "200": { description: "OK" } },
            },
          },
        },
      };

      const yaml = specToYaml(spec);
      assertIncludes(yaml, "name: limit");
    });

    it("should handle empty objects as {}", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {},
      };

      const yaml = specToYaml(spec);
      assertIncludes(yaml, "paths:{}");
    });
  });
});
