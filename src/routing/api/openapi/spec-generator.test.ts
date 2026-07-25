import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateOpenAPISpec,
  OpenAPISpecGenerationError,
  OpenAPISpecSerializationError,
  OpenAPISpecUnavailableError,
  specToJson,
  specToYaml,
} from "./spec-generator.ts";
import type { OpenAPISpec } from "./types.ts";
import { ApiRouteMatcher } from "../api-route-matcher.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { parse as parseYaml } from "@std/yaml/parse";

const LOCAL_SPEC_OPTIONS = { isLocalProject: true } as const;

function assertIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), true);
}

function assertNotIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), false);
}

describe("routing/api/openapi/spec-generator", () => {
  it("rejects remote and unknown locality before reading route modules", async () => {
    let fileReads = 0;
    const adapter = {
      fs: {
        readFile: () => {
          fileReads++;
          return Promise.resolve("export function GET() {}");
        },
      },
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;
    const router = new ApiRouteMatcher();
    router.addRoute("/api/resource", "/project/app/api/resource/route.ts");

    try {
      for (const options of [undefined, { isLocalProject: false }]) {
        await assertRejects(
          () => generateOpenAPISpec(router, "/project", adapter, undefined, options),
          OpenAPISpecUnavailableError,
          "explicitly local project",
        );
      }
    } finally {
      router.destroy();
    }

    assertEquals(fileReads, 0);
  });

  it("trusts only an own locality data property before reading route modules", async () => {
    let fileReads = 0;
    let accessorCalls = 0;
    let throwingDescriptorCalls = 0;
    const adapter = {
      fs: {
        readFile: () => {
          fileReads++;
          return Promise.resolve("export function GET() {}");
        },
      },
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;
    const router = new ApiRouteMatcher();
    router.addRoute("/api/resource", "/project/app/api/resource/route.ts");
    const inherited = Object.create({ isLocalProject: true });
    const accessor = Object.defineProperty({}, "isLocalProject", {
      get() {
        accessorCalls++;
        return true;
      },
    });
    const throwingProxy = new Proxy({}, {
      getOwnPropertyDescriptor(target, key) {
        if (key === "isLocalProject") {
          throwingDescriptorCalls++;
          throw new Error("locality descriptor unavailable");
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const revoked = Proxy.revocable({ isLocalProject: true }, {});
    revoked.revoke();
    const previous = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "isLocalProject",
    );

    try {
      for (const options of [inherited, accessor, throwingProxy, revoked.proxy]) {
        await assertRejects(
          () =>
            generateOpenAPISpec(
              router,
              "/project",
              adapter,
              undefined,
              options,
            ),
          OpenAPISpecUnavailableError,
        );
      }

      Object.defineProperty(Object.prototype, "isLocalProject", {
        configurable: true,
        value: true,
      });
      await assertRejects(
        () => generateOpenAPISpec(router, "/project", adapter, undefined, {}),
        OpenAPISpecUnavailableError,
      );
    } finally {
      if (previous) {
        Object.defineProperty(Object.prototype, "isLocalProject", previous);
      } else {
        delete (Object.prototype as { isLocalProject?: boolean }).isLocalProject;
      }
      router.destroy();
    }

    assertEquals(fileReads, 0);
    assertEquals(accessorCalls, 0);
    assertEquals(throwingDescriptorCalls, 1);
  });

  it("documents only routes in the exact /api URL namespace", async () => {
    let fileReads = 0;
    const adapter = {
      fs: {
        readFile: () => {
          fileReads++;
          return Promise.resolve("export function GET() {}");
        },
      },
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;
    const router = new ApiRouteMatcher();
    router.addRoute("/apiary", "/project/app/apiary/route.ts");
    router.addRoute("/users", "/project/app/api/users/route.ts");

    try {
      const spec = await generateOpenAPISpec(
        router,
        "/project",
        adapter,
        undefined,
        LOCAL_SPEC_OPTIONS,
      );
      assertEquals(spec.paths, {});
      assertEquals(fileReads, 0);
    } finally {
      router.destroy();
    }
  });

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
          () =>
            generateOpenAPISpec(
              router,
              "/project",
              adapter,
              undefined,
              LOCAL_SPEC_OPTIONS,
            ),
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
        () =>
          generateOpenAPISpec(
            router,
            "/project",
            adapter,
            undefined,
            LOCAL_SPEC_OPTIONS,
          ),
        OpenAPISpecGenerationError,
        'route shape collides with "/api/users/[id]"',
      );
    } finally {
      router.destroy();
    }

    assertEquals(fileReads, 0);
  });

  it("uses code-unit ordering for canonically equivalent route patterns", async () => {
    const decomposed = "/api/users/[e\u0301]";
    const composed = "/api/users/[\u00e9]";
    const adapter = {
      fs: {
        readFile: () => Promise.reject(new Error("route loading must not run")),
      },
      env: { get: () => undefined },
    } as unknown as RuntimeAdapter;

    const collisionMessage = async (patterns: string[]): Promise<string> => {
      const router = new ApiRouteMatcher();
      for (let index = 0; index < patterns.length; index++) {
        const pattern = patterns[index]!;
        router.addRoute(pattern, `/project/app/api/route-${index}.ts`);
      }
      try {
        const error = await assertRejects(
          () =>
            generateOpenAPISpec(
              router,
              "/project",
              adapter,
              undefined,
              LOCAL_SPEC_OPTIONS,
            ),
          OpenAPISpecGenerationError,
        ) as OpenAPISpecGenerationError;
        return error.message;
      } finally {
        router.destroy();
      }
    };

    const forward = await collisionMessage([composed, decomposed]);
    const reverse = await collisionMessage([decomposed, composed]);

    assertEquals(forward, reverse);
    assertEquals(
      forward.includes(`route shape collides with ${JSON.stringify(decomposed)}`),
      true,
    );
  });

  it("preserves route and cause provenance when module loading fails", async () => {
    const adapter = createMockAdapter();
    const router = new ApiRouteMatcher();
    router.addRoute("/api/broken", "/project/app/api/broken/route.ts");

    try {
      const error = await assertRejects(
        () =>
          generateOpenAPISpec(
            router,
            "/project",
            adapter,
            undefined,
            LOCAL_SPEC_OPTIONS,
          ),
        OpenAPISpecGenerationError,
        'route "/api/broken"',
      ) as OpenAPISpecGenerationError;

      assertEquals(error.message.includes("File not found"), true);
      assertEquals(error.cause instanceof Error, true);
    } finally {
      router.destroy();
    }
  });

  describe("spec serialization", () => {
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
      assertIncludes(yaml, "paths: {}");
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

    it("omits undefined object properties from JSON and YAML", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0", description: undefined },
        paths: {},
      };

      const yaml = specToYaml(spec);
      const json = specToJson(spec);
      assertNotIncludes(yaml, "description");
      assertNotIncludes(json, "description");
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
      const parsed = parseYaml(yaml) as OpenAPISpec;
      assertEquals(parsed.paths["/api/users"]?.get?.summary, "key: value pair");
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
      assertIncludes(yaml, "paths: {}");
    });

    it("round-trips YAML-sensitive strings without changing their values", () => {
      const spec: OpenAPISpec = {
        openapi: "3.1.0",
        info: {
          title: "true",
          version: "01",
          description: "",
        },
        paths: {
          "/api/items": {
            get: {
              summary: "null",
              description: String.raw`C:\routes\items`,
              responses: { "200": { description: "# accepted" } },
            },
          },
        },
      };

      const parsedJson = JSON.parse(specToJson(spec)) as OpenAPISpec;
      const parsedYaml = parseYaml(specToYaml(spec)) as OpenAPISpec;

      assertEquals(parsedJson, spec);
      assertEquals(parsedYaml, parsedJson);
    });

    it("normalizes negative zero identically in JSON and YAML", () => {
      const spec = {
        openapi: "3.1.0",
        info: { title: "API", version: "1.0.0" },
        paths: {},
        sample: -0,
      } as unknown as OpenAPISpec;
      const parsedJson = JSON.parse(specToJson(spec)) as { sample: number };
      const parsedYaml = parseYaml(specToYaml(spec)) as { sample: number };

      assertEquals(parsedYaml, parsedJson);
      assertEquals(parsedJson.sample, 0);
      assertEquals(Object.is(parsedJson.sample, -0), false);
      assertEquals(Object.is(parsedYaml.sample, -0), false);
    });

    it("rejects values that JSON and YAML cannot represent consistently", () => {
      const unsupportedValues: Array<{ value: unknown; reason: string }> = [
        { value: () => undefined, reason: "unsupported function value" },
        { value: Symbol("unsupported"), reason: "unsupported symbol value" },
        { value: 1n, reason: "unsupported bigint value" },
        { value: Number.NaN, reason: "non-finite number" },
        { value: Number.POSITIVE_INFINITY, reason: "non-finite number" },
      ];

      for (const { value, reason } of unsupportedValues) {
        const spec = {
          openapi: "3.1.0",
          info: { title: "API", version: "1.0.0" },
          paths: {},
          extension: value,
        } as unknown as OpenAPISpec;

        assertThrows(
          () => specToJson(spec),
          OpenAPISpecSerializationError,
          reason,
        );
        assertThrows(
          () => specToYaml(spec),
          OpenAPISpecSerializationError,
          reason,
        );
      }
    });

    it("wraps throwing and revoked proxy inspection failures for both formats", () => {
      const inspectionFailure = new Error("private proxy inspection detail");
      const throwingProxy = new Proxy({}, {
        ownKeys() {
          throw inspectionFailure;
        },
      });
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      const serializers = [specToJson, specToYaml];

      for (const serialize of serializers) {
        const throwingSpec = {
          openapi: "3.1.0",
          info: { title: "API", version: "1.0.0" },
          paths: {},
          extension: throwingProxy,
        } as unknown as OpenAPISpec;
        const throwingError = assertThrows(
          () => serialize(throwingSpec),
          OpenAPISpecSerializationError,
          "inspection or encoding failed",
        ) as OpenAPISpecSerializationError;
        assertEquals(throwingError.cause, inspectionFailure);

        const revokedSpec = {
          openapi: "3.1.0",
          info: { title: "API", version: "1.0.0" },
          paths: {},
          extension: revoked.proxy,
        } as unknown as OpenAPISpec;
        const revokedError = assertThrows(
          () => serialize(revokedSpec),
          OpenAPISpecSerializationError,
          "inspection or encoding failed",
        ) as OpenAPISpecSerializationError;
        assertEquals(revokedError.cause instanceof TypeError, true);
      }
    });

    it("does not misclassify accessors after descriptor prototype poisoning", () => {
      const previous = Object.getOwnPropertyDescriptor(
        Object.prototype,
        "value",
      );
      let accessorCalls = 0;
      const accessorObject = Object.defineProperty({}, "secret", {
        enumerable: true,
        get() {
          accessorCalls++;
          return "private";
        },
      });
      const accessorArray: unknown[] = [];
      Object.defineProperty(accessorArray, "0", {
        enumerable: true,
        get() {
          accessorCalls++;
          return "private";
        },
      });
      accessorArray.length = 1;
      const errors: unknown[] = [];

      try {
        Object.defineProperty(Object.prototype, "value", {
          configurable: true,
          value: "forged descriptor value",
        });
        for (const extension of [accessorObject, accessorArray]) {
          const spec = {
            openapi: "3.1.0",
            info: { title: "API", version: "1.0.0" },
            paths: {},
            extension,
          } as unknown as OpenAPISpec;
          for (const serialize of [specToJson, specToYaml]) {
            try {
              serialize(spec);
            } catch (error) {
              errors.push(error);
            }
          }
        }
      } finally {
        if (previous) {
          Object.defineProperty(Object.prototype, "value", previous);
        } else {
          delete (Object.prototype as { value?: unknown }).value;
        }
      }

      assertEquals(errors.length, 4);
      for (const error of errors) {
        assertEquals(error instanceof OpenAPISpecSerializationError, true);
        assertEquals(
          (error as Error).message.includes("sparse or undefined array entry") ||
            (error as Error).message.includes("accessor property"),
          true,
        );
      }
      assertEquals(accessorCalls, 0);
    });
  });
});
