import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { specToYaml } from "./spec-generator.ts";
import type { OpenAPISpec } from "./types.ts";

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
      assertEquals(yaml.includes("openapi: 3.1.0"), true);
      assertEquals(yaml.includes("title: Test API"), true);
      assertEquals(yaml.includes("version: 1.0.0"), true);
      assertEquals(yaml.includes("paths:{}"), true);
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
      assertEquals(yaml.includes("description: A test API"), true);
    });

    it("should handle spec with tags", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {},
        tags: [{ name: "users" }, { name: "posts" }],
      };

      const yaml = specToYaml(spec);
      assertEquals(yaml.includes("- name: users"), true);
      assertEquals(yaml.includes("- name: posts"), true);
    });

    it("should handle spec with servers", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {},
        servers: [{ url: "https://api.example.com", description: "Production" }],
      };

      const yaml = specToYaml(spec);
      assertEquals(yaml.includes("servers:"), true);
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
      assertEquals(yaml.includes("summary: List users"), true);
    });

    it("should handle empty arrays as []", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {},
        tags: [],
      };

      const yaml = specToYaml(spec);
      assertEquals(yaml.includes("tags: []"), true);
    });

    it("should handle null values", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0", description: undefined },
        paths: {},
      };

      const yaml = specToYaml(spec);
      // undefined values should be filtered out
      assertEquals(yaml.includes("description"), false);
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
      assertEquals(yaml.includes('"key: value pair"'), true);
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
      assertEquals(yaml.includes("deprecated: true"), true);
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
      assertEquals(yaml.includes("name: limit"), true);
    });

    it("should handle empty objects as {}", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {},
      };

      const yaml = specToYaml(spec);
      assertEquals(yaml.includes("paths:{}"), true);
    });
  });
});
