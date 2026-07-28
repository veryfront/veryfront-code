import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert";
import { stub } from "#std/testing/mock";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { resource } from "./factory.ts";
import type { ResourceConfig } from "./types.ts";

describe("resource factory", () => {
  describe("resource()", () => {
    it("should create a resource with explicit pattern", () => {
      const r = resource({
        pattern: "/users/:userId",
        description: "Get user",
        paramsSchema: defineSchema((v) => v.object({ userId: v.string() }))(),
        load: async ({ userId }) => ({ id: userId }),
      });
      assertEquals(r.pattern, "/users/:userId");
      assertEquals(r.__veryfrontGeneratedPattern, undefined);
      assertEquals(r.description, "Get user");
    });

    it("should derive id from pattern", () => {
      const r = resource({
        pattern: "/users/:userId/profile",
        description: "User profile",
        paramsSchema: defineSchema((v) => v.object({ userId: v.string() }))(),
        load: async () => ({}),
      });
      assertEquals(r.id, "users_userId_profile");
    });

    it("should auto-generate pattern when not provided", () => {
      const r = resource({
        description: "Auto pattern",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });
      assertStringIncludes(r.pattern, "/resource_");
      assertEquals(r.__veryfrontGeneratedPattern, r.pattern);
    });

    it("should generate unique fallback patterns within the same millisecond", () => {
      using _dateNow = stub(Date, "now", () => 1_234);
      const first = resource({
        description: "First",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });
      const second = resource({
        description: "Second",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });

      assertEquals(first.pattern === second.pattern, false);
      assertEquals(first.id === second.id, false);
    });

    it("should preserve paramsSchema", () => {
      const schema = defineSchema((v) => v.object({ section: v.string() }))();
      const r = resource({
        pattern: "/docs/:section",
        description: "Docs",
        paramsSchema: schema,
        load: async () => ({}),
      });
      assertEquals(r.paramsSchema, schema);
    });

    it("should preserve mcp config", () => {
      const r = resource({
        pattern: "/data",
        description: "Data",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
        mcp: {
          enabled: true,
          content: { type: "text", mimeType: "text/plain" },
        },
      });
      assertEquals(r.mcp?.enabled, true);
      assertEquals(r.mcp?.content, { type: "text", mimeType: "text/plain" });
      assertEquals(Object.isFrozen(r.mcp), true);
      assertEquals(Object.isFrozen(r.mcp?.content), true);
    });

    it("should snapshot configuration functions and MCP metadata", async () => {
      const mcp = {
        enabled: true,
        content: { type: "text" as const, mimeType: "text/plain" },
      };
      const config: ResourceConfig<Record<string, never>, string> = {
        pattern: "/stable",
        description: "Stable",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => "original",
        mcp,
      };
      const r = resource(config);

      config.load = () => "mutated";
      mcp.enabled = false;
      mcp.content.mimeType = "text/html";

      assertEquals(await r.load({}), "original");
      assertEquals(r.mcp, {
        enabled: true,
        content: { type: "text", mimeType: "text/plain" },
      });
    });

    it("should snapshot frozen accessor-backed configuration exactly once", async () => {
      let loadReads = 0;
      let enabledReads = 0;
      let enabled = true;
      const config = {
        pattern: "/accessor-backed",
        description: "Accessor backed",
        paramsSchema: defineSchema((v) => v.object({}))(),
        get load() {
          loadReads += 1;
          return () => "captured";
        },
        mcp: Object.freeze({
          get enabled() {
            enabledReads += 1;
            return enabled;
          },
        }),
      };

      const r = resource(config);
      enabled = false;

      assertEquals(loadReads, 1);
      assertEquals(enabledReads, 1);
      assertEquals(await r.load({}), "captured");
      assertEquals(r.mcp?.enabled, true);
    });

    it("should capture the schema parser used by runtime validation", async () => {
      const paramsSchema = {
        parse: (value: unknown) => ({
          value: String((value as { value?: unknown }).value),
        }),
      };
      const r = resource({
        pattern: "/captured-schema/:value",
        description: "Captured schema",
        paramsSchema: paramsSchema as never,
        load: ({ value }: { value: string }) => value,
      });

      paramsSchema.parse = () => ({ value: "mutated" });

      assertEquals(await r.load({ value: "original" }), "original");
    });

    it("should derive a usable id for the root URI", () => {
      const root = resource({
        pattern: "/",
        description: "Root",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });

      assertEquals(root.id, "root");
    });

    it("should reject malformed runtime configuration", () => {
      assertThrows(
        () => resource(null as never),
        TypeError,
        "Resource configuration must be an object",
      );
      assertThrows(
        () =>
          resource({
            pattern: "/invalid",
            description: "Invalid",
            paramsSchema: {} as never,
            load: () => ({}),
          }),
        TypeError,
        "paramsSchema.parse must be a function",
      );
      assertThrows(
        () =>
          resource({
            pattern: "/invalid-mime",
            description: "Invalid MIME",
            paramsSchema: defineSchema((v) => v.object({}))(),
            load: () => "content",
            mcp: {
              content: {
                type: "text",
                mimeType: "text/plain\r\nX-Injected: yes",
              },
            },
          }),
        TypeError,
        "MCP content mimeType must be a valid media type",
      );
      assertThrows(
        () =>
          resource({
            pattern: "/invalid-folded-mime",
            description: "Invalid folded MIME",
            paramsSchema: defineSchema((v) => v.object({}))(),
            load: () => "content",
            mcp: {
              content: {
                type: "text",
                mimeType: "text/plain;\r\ncharset=utf-8",
              },
            },
          }),
        TypeError,
        "MCP content mimeType must be a valid media type",
      );
      assertThrows(
        () =>
          resource({
            pattern: "/unknown-mcp-field",
            description: "Invalid MCP field",
            paramsSchema: defineSchema((v) => v.object({}))(),
            load: () => ({}),
            mcp: {
              enabled: true,
              typo: true,
            } as never,
          }),
        TypeError,
        'Resource MCP configuration contains unsupported field "typo"',
      );
      assertThrows(
        () =>
          resource({
            pattern: "/unsupported-cache-policy",
            description: "Unsupported cache policy",
            paramsSchema: defineSchema((v) => v.object({}))(),
            load: () => ({}),
            mcp: {
              cachePolicy: "cache",
            } as never,
          }),
        TypeError,
        'Resource MCP configuration contains unsupported field "cachePolicy"',
      );
      assertThrows(
        () =>
          resource({
            pattern: "/unknown-content-field",
            description: "Invalid content field",
            paramsSchema: defineSchema((v) => v.object({}))(),
            load: () => "content",
            mcp: {
              content: {
                type: "text",
                mimeType: "text/plain",
                typo: true,
              } as never,
            },
          }),
        TypeError,
        'Resource MCP content configuration contains unsupported field "typo"',
      );
      assertThrows(
        () =>
          resource({
            pattern: "/oversized-description",
            description: "x".repeat(16 * 1024 + 1),
            paramsSchema: defineSchema((v) => v.object({}))(),
            load: () => ({}),
          }),
        TypeError,
        "Resource description must not exceed 16384 characters",
      );
      assertThrows(
        () =>
          resource({
            pattern: "/oversized-title",
            description: "Oversized title",
            title: "x".repeat(1024 + 1),
            paramsSchema: defineSchema((v) => v.object({}))(),
            load: () => ({}),
          }),
        TypeError,
        "Resource title must not exceed 1024 characters",
      );
    });

    it("should expose configured subscription support", () => {
      const subscribeFn = async function* () {
        yield { data: "test" };
      };
      const r = resource({
        pattern: "/stream",
        description: "Stream",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
        subscribe: subscribeFn,
      });
      assertEquals(typeof r.subscribe, "function");
    });
  });

  describe("load()", () => {
    it("should validate params and call load function", async () => {
      const r = resource({
        pattern: "/items/:id",
        description: "Item",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: async ({ id }) => ({ name: `Item ${id}` }),
      });
      const result = await r.load({ id: "123" });
      assertEquals(result, { name: "Item 123" });
    });

    it("should throw on invalid params", async () => {
      const r = resource({
        pattern: "/items/:id",
        description: "Item",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: async () => ({}),
      });
      await assertRejects(
        () => r.load({ id: 42 } as unknown as { id: string }),
        Error,
        "params validation failed",
      );
    });

    it("should include the derived resource id in validation errors", async () => {
      const r = resource({
        pattern: "/items/:id/details",
        description: "Item details",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: async () => ({}),
      });

      await assertRejects(
        () => r.load({ id: 42 } as unknown as { id: string }),
        Error,
        'Resource "items_id_details" params validation failed',
      );
    });

    it("should not call load when params validation fails", async () => {
      let loadCalls = 0;
      const r = resource({
        pattern: "/items/:id",
        description: "Item",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: async () => {
          loadCalls += 1;
          return {};
        },
      });

      await assertRejects(
        () => r.load({ id: 42 } as unknown as { id: string }),
        Error,
      );

      assertEquals(loadCalls, 0);
    });

    it("should support sync load functions", async () => {
      const r = resource({
        pattern: "/sync",
        description: "Sync",
        paramsSchema: defineSchema((v) => v.object({ key: v.string() }))(),
        load: ({ key }) => ({ value: key }),
      });
      const result = await r.load({ key: "test" });
      assertEquals(result, { value: "test" });
    });

    it("should pass transformed schema output to the load function", async () => {
      const r = resource({
        pattern: "/normalized/:key",
        description: "Normalized value",
        paramsSchema: defineSchema((v) =>
          v.object({
            key: v.string().transform((value) => value.toUpperCase()),
          })
        )(),
        load: ({ key }) => key,
      });

      assertEquals(await r.load({ key: "lower" }), "LOWER");
    });

    it("should not invoke a loader for a pre-aborted read", async () => {
      const controller = new AbortController();
      controller.abort();
      let loadCalls = 0;
      const r = resource({
        pattern: "/cancelled",
        description: "Cancelled",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => {
          loadCalls += 1;
          return {};
        },
      });

      await assertRejects(
        () => r.load({}, { abortSignal: controller.signal }),
        DOMException,
        "Resource loading aborted",
      );
      assertEquals(loadCalls, 0);
    });

    it("should cancel a pending loader even when it ignores the signal", async () => {
      const controller = new AbortController();
      const started = Promise.withResolvers<void>();
      let receivedSignal: AbortSignal | undefined;
      const r = resource({
        pattern: "/pending",
        description: "Pending",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: (_params, context) => {
          receivedSignal = context?.abortSignal;
          started.resolve();
          return new Promise<Record<string, never>>(() => {});
        },
      });

      const pending = r.load({}, { abortSignal: controller.signal });
      await started.promise;
      controller.abort();

      await assertRejects(
        () => pending,
        DOMException,
        "Resource loading aborted",
      );
      assertEquals(receivedSignal, controller.signal);
    });

    it("should snapshot read-context accessors exactly once", async () => {
      let uriReads = 0;
      let currentUri = "/context/original";
      let receivedUri: string | undefined;
      const r = resource({
        pattern: "/context/:value",
        description: "Context snapshot",
        paramsSchema: defineSchema((v) => v.object({ value: v.string() }))(),
        load: (_params, context) => {
          receivedUri = context?.uri;
          return {};
        },
      });
      const context = Object.freeze({
        get uri() {
          uriReads += 1;
          return currentUri;
        },
      });

      const pending = r.load({ value: "original" }, context);
      currentUri = "/context/mutated";
      await pending;

      assertEquals(uriReads, 1);
      assertEquals(receivedUri, "/context/original");
    });
  });

  describe("subscribe()", () => {
    it("should validate and transform params before subscribing", async () => {
      let received = "";
      const r = resource({
        pattern: "/events/:topic",
        description: "Events",
        paramsSchema: defineSchema((v) =>
          v.object({
            topic: v.string().transform((value) => value.toUpperCase()),
          })
        )(),
        load: ({ topic }) => topic,
        subscribe: async function* ({ topic }) {
          received = topic;
          yield topic;
        },
      });

      const values: string[] = [];
      for await (const value of r.subscribe!({ topic: "news" })) {
        values.push(value);
      }

      assertEquals(received, "NEWS");
      assertEquals(values, ["NEWS"]);
    });

    it("should reject invalid params before invoking subscribe", () => {
      let subscribeCalls = 0;
      const r = resource({
        pattern: "/events/:topic",
        description: "Events",
        paramsSchema: defineSchema((v) => v.object({ topic: v.string() }))(),
        load: async () => ({}),
        subscribe: async function* () {
          subscribeCalls += 1;
          yield {};
        },
      });

      assertThrows(
        () => r.subscribe!({ topic: 42 } as unknown as { topic: string }),
        Error,
        "params validation failed",
      );
      assertEquals(subscribeCalls, 0);
    });
  });

  describe("pattern to id conversion", () => {
    it("should strip leading slash", () => {
      const r = resource({
        pattern: "/simple",
        description: "Simple",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });
      assertEquals(r.id, "simple");
    });

    it("should replace slashes with underscores", () => {
      const r = resource({
        pattern: "/a/b/c",
        description: "Nested",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });
      assertEquals(r.id, "a_b_c");
    });

    it("should remove colons from params", () => {
      const r = resource({
        pattern: "/users/:userId/posts/:postId",
        description: "User posts",
        paramsSchema: defineSchema((v) => v.object({ userId: v.string(), postId: v.string() }))(),
        load: async () => ({}),
      });
      assertEquals(r.id, "users_userId_posts_postId");
    });
  });

  describe("pattern validation", () => {
    it("should reject duplicate parameter names at definition time", () => {
      assertThrows(
        () =>
          resource({
            pattern: "/users/:id/posts/:id",
            description: "Invalid duplicate",
            paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
            load: async () => ({}),
          }),
        Error,
        'duplicate parameter "id"',
      );
    });

    it("should reject malformed parameter segments", () => {
      assertThrows(
        () =>
          resource({
            pattern: "/users/:123",
            description: "Invalid parameter",
            paramsSchema: defineSchema((v) => v.object({}))(),
            load: async () => ({}),
          }),
        Error,
        'invalid parameter segment ":123"',
      );
    });
  });
});
