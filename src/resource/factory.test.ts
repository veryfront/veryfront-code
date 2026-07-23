import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { resource } from "./factory.ts";

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

    it("uses an explicit id when a derived id would be ambiguous", () => {
      const r = resource({
        id: "nested-a-b",
        pattern: "/a/b",
        description: "Nested",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });

      assertEquals(r.id, "nested-a-b");
    });

    it("should auto-generate pattern when not provided", () => {
      const r = resource({
        description: "Auto pattern",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });
      assertStringIncludes(r.pattern, "/resource_");
    });

    it("generates collision-resistant patterns without relying on the clock", () => {
      const originalNow = Date.now;
      Date.now = () => 1;
      try {
        const first = resource({
          description: "First",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => ({}),
        });
        const second = resource({
          description: "Second",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => ({}),
        });

        assertNotEquals(first.pattern, second.pattern);
      } finally {
        Date.now = originalNow;
      }
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
        mcp: { enabled: true, cachePolicy: "cache-first" },
      });
      assertEquals(r.mcp?.enabled, true);
      assertEquals(r.mcp?.cachePolicy, "cache-first");
    });

    it("should preserve subscription behavior", async () => {
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
      const values = [];
      for await (const value of r.subscribe?.({}) ?? []) values.push(value);
      assertEquals(values, [{ data: "test" }]);
    });

    it("snapshots mutable configuration and returns an immutable definition", async () => {
      const config = {
        pattern: "/stable",
        description: "Stable",
        paramsSchema: defineSchema((v) => v.object({ value: v.string() }))(),
        load: ({ value }: { value: string }) => ({ value }),
        mcp: { enabled: true, cachePolicy: "cache" as const },
      };
      const r = resource(config);

      config.pattern = "/mutated";
      config.description = "Mutated";
      config.load = () => ({ value: "mutated" });
      config.mcp.enabled = false;

      assertEquals(r.pattern, "/stable");
      assertEquals(r.description, "Stable");
      assertEquals(await r.load({ value: "original" }), { value: "original" });
      assertEquals(r.mcp, { enabled: true, cachePolicy: "cache" });
      assertEquals(Object.isFrozen(r), true);
      assertEquals(Object.isFrozen(r.mcp), true);
    });

    it("captures a stateful schema parser exactly once", async () => {
      let parserReads = 0;
      const paramsSchema = Object.defineProperty({}, "parse", {
        get() {
          parserReads++;
          if (parserReads > 1) throw new Error("parse getter read twice");
          return (input: unknown) => input as { value: string };
        },
      });

      const r = resource({
        pattern: "/single-parser-read",
        description: "Single parser read",
        paramsSchema: paramsSchema as { parse(input: unknown): { value: string } },
        load: ({ value }) => ({ value }),
      });

      assertEquals(await r.load({ value: "stable" }), { value: "stable" });
      assertEquals(parserReads, 1);
    });

    it("rejects malformed resource definitions synchronously", () => {
      const schema = defineSchema((v) => v.object({}))();
      for (
        const config of [
          null,
          { pattern: "", description: "Empty", paramsSchema: schema, load: () => ({}) },
          {
            pattern: "/empty-description",
            description: "",
            paramsSchema: schema,
            load: () => ({}),
          },
          {
            pattern: "/empty-title",
            description: "Empty title",
            title: "",
            paramsSchema: schema,
            load: () => ({}),
          },
          {
            pattern: "/duplicate/:id/:id",
            description: "Duplicate parameter",
            paramsSchema: schema,
            load: () => ({}),
          },
          { pattern: "/missing-load", description: "Missing", paramsSchema: schema },
          { pattern: "/missing-schema", description: "Missing", load: () => ({}) },
          {
            pattern: "/invalid-schema",
            description: "Invalid schema",
            paramsSchema: { parse: true },
            load: () => ({}),
          },
          {
            pattern: "/invalid-subscription",
            description: "Invalid subscription",
            paramsSchema: schema,
            load: () => ({}),
            subscribe: true,
          },
          {
            pattern: "/bad-mcp",
            description: "Bad MCP",
            paramsSchema: schema,
            load: () => ({}),
            mcp: { cachePolicy: "sometimes" },
          },
          {
            pattern: "/unknown-mcp",
            description: "Unknown MCP",
            paramsSchema: schema,
            load: () => ({}),
            mcp: { enabled: true, unknown: true },
          },
          {
            pattern: "/invalid-mcp",
            description: "Invalid MCP",
            paramsSchema: schema,
            load: () => ({}),
            mcp: null,
          },
          {
            pattern: "/invalid-mcp-enabled",
            description: "Invalid MCP enabled",
            paramsSchema: schema,
            load: () => ({}),
            mcp: { enabled: "yes" },
          },
          {
            pattern: "/unreadable-mcp",
            description: "Unreadable MCP",
            paramsSchema: schema,
            load: () => ({}),
            mcp: new Proxy({}, {
              ownKeys() {
                throw new Error("unreadable MCP configuration");
              },
            }),
          },
        ]
      ) {
        assertThrows(() => resource(config as never), Error);
      }
    });

    it("rejects unsupported and inherited configuration properties", () => {
      const schema = defineSchema((v) => v.object({}))();
      assertThrows(() =>
        resource({
          pattern: "/unknown",
          description: "Unknown",
          paramsSchema: schema,
          load: () => ({}),
          unexpected: true,
        } as never)
      );

      const inherited = Object.create({
        pattern: "/inherited",
        description: "Inherited",
        paramsSchema: schema,
        load: () => ({}),
      });
      assertThrows(() => resource(inherited), Error);

      assertThrows(
        () =>
          resource(
            new Proxy({}, {
              ownKeys() {
                throw new Error("unreadable keys");
              },
            }) as never,
          ),
        Error,
      );

      assertThrows(
        () =>
          resource({
            get pattern(): string {
              throw new Error("unreadable property");
            },
            description: "Unreadable",
            paramsSchema: schema,
            load: () => ({}),
          }),
        Error,
      );
    });

    it("reads each supported configuration property at most once", async () => {
      const reads = new Map<PropertyKey, number>();
      const values: Record<PropertyKey, unknown> = {
        id: "single-read",
        pattern: "/single-read-config",
        description: "Single read",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({ ok: true }),
      };
      const config = new Proxy(values, {
        get(target, property, receiver) {
          reads.set(property, (reads.get(property) ?? 0) + 1);
          if ((reads.get(property) ?? 0) > 1) throw new Error("property read twice");
          return Reflect.get(target, property, receiver);
        },
      });

      const r = resource(config as never);
      assertEquals(await r.load({}), { ok: true });
      for (const count of reads.values()) assertEquals(count, 1);
    });

    it("rejects bidirectional controls in public metadata and patterns", () => {
      const schema = defineSchema((v) => v.object({}))();
      for (
        const config of [
          {
            id: "unsafe\u202eid",
            pattern: "/safe",
            description: "Safe",
            paramsSchema: schema,
            load: () => ({}),
          },
          {
            pattern: "/unsafe\u202epath",
            description: "Safe",
            paramsSchema: schema,
            load: () => ({}),
          },
          {
            pattern: "/safe",
            description: "Unsafe\u202edescription",
            paramsSchema: schema,
            load: () => ({}),
          },
        ]
      ) {
        assertThrows(() => resource(config), Error);
      }
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

    it("passes parsed and transformed parameters to the loader", async () => {
      const r = resource({
        pattern: "/items/:id",
        description: "Item",
        paramsSchema: defineSchema((v) =>
          v.object({ id: v.string().transform((id) => id.toUpperCase()) })
        )(),
        load: ({ id }) => ({ id }),
      });

      assertEquals(await r.load({ id: "abc" }), { id: "ABC" });
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

    it("does not expose validator failures in the public error message", async () => {
      const paramsSchema = {
        parse(): never {
          throw new Error("private validator detail must stay internal");
        },
      };
      const r = resource({
        pattern: "/private/:id",
        description: "Private",
        paramsSchema: paramsSchema as never,
        load: () => ({}),
      });

      const error = await assertRejects(() => r.load({ id: "x" }));
      const message = error instanceof Error ? error.message : "";
      assertEquals(message.includes("private validator detail"), false);
      assertStringIncludes(message, 'Resource "private_id" params validation failed');
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

    it("validates and transforms subscription parameters", async () => {
      let calls = 0;
      const r = resource({
        pattern: "/stream/:topic",
        description: "Stream",
        paramsSchema: defineSchema((v) =>
          v.object({ topic: v.string().transform((topic) => topic.toUpperCase()) })
        )(),
        load: () => ({}),
        subscribe: async function* ({ topic }) {
          calls++;
          yield { topic };
        },
      });

      const values = [];
      for await (const value of r.subscribe?.({ topic: "news" }) ?? []) values.push(value);
      assertEquals(values, [{ topic: "NEWS" }]);

      await assertRejects(async () => {
        for await (
          const _value of r.subscribe?.({ topic: 42 } as unknown as { topic: string }) ?? []
        ) {
          // Validation must fail before the source iterator yields.
        }
      });
      assertEquals(calls, 1);
    });

    it("reads the subscription iterator boundary once", async () => {
      let iterableReads = 0;
      let nextReads = 0;
      const r = resource({
        pattern: "/single-read",
        description: "Single read",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
        subscribe: () => {
          const iterator = (async function* () {
            yield "value";
          })();
          const capturedNext = iterator.next.bind(iterator);
          const statefulIterator = Object.defineProperty({}, "next", {
            get() {
              nextReads++;
              if (nextReads > 1) throw new Error("next getter read twice");
              return capturedNext;
            },
          });
          return Object.defineProperty({}, Symbol.asyncIterator, {
            get() {
              iterableReads++;
              if (iterableReads > 1) throw new Error("iterator getter read twice");
              return () => statefulIterator;
            },
          }) as AsyncIterable<string>;
        },
      });

      const values = [];
      for await (const value of r.subscribe?.({}) ?? []) values.push(value);
      assertEquals(values, ["value"]);
      assertEquals(iterableReads, 1);
      assertEquals(nextReads, 1);
    });

    it("passes an immutable lifecycle context to loaders", async () => {
      const controller = new AbortController();
      let observedContext: unknown;
      const r = resource({
        pattern: "/context",
        description: "Context",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: (_params, context) => {
          observedContext = context;
          return { ok: true };
        },
      });

      assertEquals(await r.load({}, { signal: controller.signal }), { ok: true });
      assertEquals(Object.isFrozen(observedContext), true);
      assertStrictEquals(
        (observedContext as { signal?: AbortSignal }).signal,
        controller.signal,
      );
    });

    it("does not parse or load when cancellation has already been requested", async () => {
      let parseCalls = 0;
      let loadCalls = 0;
      const controller = new AbortController();
      controller.abort();
      const r = resource({
        pattern: "/cancelled",
        description: "Cancelled",
        paramsSchema: {
          parse(input: unknown) {
            parseCalls++;
            return input;
          },
        },
        load: () => {
          loadCalls++;
          return {};
        },
      });

      const error = await assertRejects(() => r.load({}, { signal: controller.signal }));
      assertEquals((error as Error).name, "AbortError");
      assertEquals(parseCalls, 0);
      assertEquals(loadCalls, 0);
    });

    it("rejects a result when cancellation happens during loading", async () => {
      const controller = new AbortController();
      const r = resource({
        pattern: "/cancel-during-load",
        description: "Cancel during load",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => {
          controller.abort();
          return { stale: true };
        },
      });

      const error = await assertRejects(() => r.load({}, { signal: controller.signal }));
      assertEquals((error as Error).name, "AbortError");
    });

    it("closes a subscription iterator when cancellation happens between values", async () => {
      const controller = new AbortController();
      let finalized = false;
      const r = resource({
        pattern: "/cancel-stream",
        description: "Cancel stream",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
        subscribe: async function* (_params, context) {
          try {
            yield "first";
            assertStrictEquals(context.signal, controller.signal);
            yield "second";
          } finally {
            finalized = true;
          }
        },
      });

      const iterator = r.subscribe?.({}, { signal: controller.signal })[Symbol.asyncIterator]();
      assert(iterator);
      assertEquals(await iterator.next(), { done: false, value: "first" });
      controller.abort();
      const error = await assertRejects(() => iterator.next());
      assertEquals((error as Error).name, "AbortError");
      assertEquals(finalized, true);
    });

    it("closes a subscription iterator when the source rejects", async () => {
      let returnCalls = 0;
      const r = resource({
        pattern: "/failing-stream",
        description: "Failing stream",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
        subscribe: (() => ({
          [Symbol.asyncIterator]() {
            return {
              next() {
                return Promise.reject(new Error("stream failed"));
              },
              return() {
                returnCalls++;
                return Promise.resolve({ done: true, value: undefined });
              },
            };
          },
        })) as never,
      });

      const iterator = r.subscribe?.({})[Symbol.asyncIterator]();
      assert(iterator);
      await assertRejects(() => iterator.next(), Error, "stream failed");
      assertEquals(returnCalls, 1);
    });

    it("rejects unsupported lifecycle context properties", async () => {
      const r = resource({
        pattern: "/invalid-context",
        description: "Invalid context",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });

      for (
        const context of [
          null,
          [],
          { signal: undefined, extra: true },
          { signal: {} },
          { signal: null },
          new Proxy({}, {
            ownKeys() {
              throw new Error("unreadable context");
            },
          }),
          {
            signal: Object.defineProperty({}, "aborted", {
              get() {
                throw new Error("unreadable signal");
              },
            }),
          },
        ]
      ) {
        await assertRejects(() => r.load({}, context as never));
      }
    });

    it("uses a discovery-supplied receiver id in validation errors", async () => {
      const generated = resource({
        description: "Discovered",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: () => ({}),
      });
      const discovered = {
        ...generated,
        id: "users-profile",
        pattern: "/users/:id/profile",
      };

      await assertRejects(
        () => discovered.load({ id: 42 } as never),
        Error,
        'Resource "users-profile" params validation failed',
      );
    });

    it("fails closed for malformed subscription iterables", async () => {
      const invalidSources: Array<() => unknown> = [
        () => null,
        () => ({}),
        () =>
          Object.defineProperty({}, Symbol.asyncIterator, {
            get() {
              throw new Error("unreadable iterator factory");
            },
          }),
        () => ({
          [Symbol.asyncIterator]() {
            throw new Error("iterator factory failed");
          },
        }),
        () => ({
          [Symbol.asyncIterator]() {
            return null;
          },
        }),
        () => ({
          [Symbol.asyncIterator]() {
            return Object.defineProperty({}, "next", {
              get() {
                throw new Error("unreadable iterator methods");
              },
            });
          },
        }),
        () => ({
          [Symbol.asyncIterator]() {
            return {};
          },
        }),
        () => ({
          [Symbol.asyncIterator]() {
            return { next: () => null };
          },
        }),
        () => ({
          [Symbol.asyncIterator]() {
            return {
              next: () =>
                Object.defineProperty({}, "done", {
                  get() {
                    throw new Error("unreadable result");
                  },
                }),
            };
          },
        }),
        () => ({
          [Symbol.asyncIterator]() {
            return { next: () => ({ done: "yes" }) };
          },
        }),
        () => ({
          [Symbol.asyncIterator]() {
            return { next: () => ({ done: true }), return: true };
          },
        }),
        () => ({
          [Symbol.asyncIterator]() {
            return { next: () => ({ done: true }), throw: true };
          },
        }),
      ];

      for (const createSource of invalidSources) {
        const r = resource({
          pattern: "/malformed-stream",
          description: "Malformed stream",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => ({}),
          subscribe: (() => createSource()) as never,
        });
        await assertRejects(async () => {
          for await (const _value of r.subscribe?.({}) ?? []) {
            // The malformed iterator must fail before it yields a value.
          }
        });
      }
    });

    it("closes a source without a return method when the consumer stops", async () => {
      let nextCalls = 0;
      const r = resource({
        pattern: "/stream-without-return",
        description: "Stream without return",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
        subscribe: (() => ({
          [Symbol.asyncIterator]() {
            return {
              next() {
                nextCalls++;
                return Promise.resolve({ done: false, value: nextCalls });
              },
            };
          },
        })) as never,
      });

      for await (const _value of r.subscribe?.({}) ?? []) break;
      assertEquals(nextCalls, 1);
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
});
