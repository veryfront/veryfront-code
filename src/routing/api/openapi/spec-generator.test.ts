import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateOpenAPISpec,
  OpenAPISpecGenerationError,
  specToYaml,
} from "./spec-generator.ts";
import type { OpenAPISpec } from "./types.ts";
import { ApiRouteMatcher } from "../api-route-matcher.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

function assertIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), true);
}

function assertNotIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), false);
}

describe("routing/api/openapi/spec-generator", () => {
  it("fails incomplete specifications before loading route modules", async () => {
    let fileReads = 0;
    const adapter = {
      fs: {
        readFile: () => {
          fileReads++;
          return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
        },
      },
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;

    const cases = [
      {
        pattern: "/api/[[...optional]]",
        message: "split the optional catch-all into explicit routes",
      },
      {
        pattern: "/api/[...first]/[[...second]]",
        message: "contains more than one catch-all parameter",
      },
      {
        pattern: "/api/users/[id",
        message: "malformed bracket",
      },
      {
        pattern: "/api/users/{id}",
        message: "literal braces",
      },
      {
        pattern: "/api/[id]/posts/[id]",
        message: 'duplicate route parameter "id"',
      },
    ];

    for (const { pattern, message } of cases) {
      const router = new ApiRouteMatcher();
      router.addRoute("/api/000-valid", "/project/app/api/valid.ts");
      router.addRoute(pattern, "/project/app/api/route.ts");
      try {
        await assertRejects(
          () => generateOpenAPISpec(router, "/project", adapter),
          Error,
          message,
        );
      } finally {
        router.destroy();
      }
    }

    assertEquals(fileReads, 0);
  });

  it("rejects equal route shapes before loading route modules", async () => {
    let fileReads = 0;
    const adapter = {
      fs: {
        readFile: () => {
          fileReads++;
          return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
        },
      },
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;
    const router = new ApiRouteMatcher();
    router.addRoute("/api/users/[id]", "/project/app/api/users/[id]/route.ts");
    router.addRoute("/api/users/[slug]", "/project/app/api/users/[slug]/route.ts");

    try {
      await assertRejects(
        () => generateOpenAPISpec(router, "/project", adapter),
        OpenAPISpecGenerationError,
        'route shape collides with "/api/users/[id]"',
      );
    } finally {
      router.destroy();
    }

    assertEquals(fileReads, 0);
  });

  it("preserves route and cause provenance when module loading fails", async () => {
    const adapter = createMockAdapter();
    const router = new ApiRouteMatcher();
    router.addRoute("/api/broken", "/project/app/api/broken/route.ts");

    try {
      const error = await assertRejects(
        () => generateOpenAPISpec(router, "/project", adapter),
        OpenAPISpecGenerationError,
        'route "/api/broken"',
      );

      assertEquals(error.message.includes("File not found"), true);
      assertEquals(error.cause instanceof Error, true);
    } finally {
      router.destroy();
    }
  });

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
