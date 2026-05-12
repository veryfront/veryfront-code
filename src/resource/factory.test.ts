import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert";
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

    it("should auto-generate pattern when not provided", () => {
      const r = resource({
        description: "Auto pattern",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });
      assertStringIncludes(r.pattern, "/resource_");
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

    it("should preserve subscribe function", () => {
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
      assertEquals(r.subscribe, subscribeFn);
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
