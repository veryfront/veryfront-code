import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { resource } from "./factory.ts";
import { resourceRegistry } from "./registry.ts";

describe("resource registry", () => {
  beforeEach(() => {
    resourceRegistry.clearAll();
  });

  afterEach(() => {
    resourceRegistry.clearAll();
  });

  describe("findByPattern()", () => {
    it("should find a registered resource whose pattern matches the uri", () => {
      const userPosts = resource({
        pattern: "/users/:userId/posts/:postId",
        description: "User post",
        paramsSchema: defineSchema((v) => v.object({ userId: v.string(), postId: v.string() }))(),
        load: async () => ({}),
      });

      resourceRegistry.register(userPosts.id, userPosts);

      assertEquals(resourceRegistry.findByPattern("/users/42/posts/7"), userPosts);
    });

    it("should return undefined when no pattern matches the uri", () => {
      const userPosts = resource({
        pattern: "/users/:userId/posts/:postId",
        description: "User post",
        paramsSchema: defineSchema((v) => v.object({ userId: v.string(), postId: v.string() }))(),
        load: async () => ({}),
      });

      resourceRegistry.register(userPosts.id, userPosts);

      assertEquals(resourceRegistry.findByPattern("/users/42/comments/7"), undefined);
    });

    it("should not match a uri whose param value spans path segments", () => {
      const userPosts = resource({
        pattern: "/users/:userId/posts/:postId",
        description: "User post",
        paramsSchema: defineSchema((v) => v.object({ userId: v.string(), postId: v.string() }))(),
        load: async () => ({}),
      });

      resourceRegistry.register(userPosts.id, userPosts);

      assertEquals(
        resourceRegistry.findByPattern("/users/42/extra/posts/7"),
        undefined,
        "a :param must not match across path segments",
      );
    });

    it("should treat regex metacharacters in patterns as literals", () => {
      const docs = resource({
        pattern: "/docs/:version/page.html",
        description: "Versioned docs page",
        paramsSchema: defineSchema((v) => v.object({ version: v.string() }))(),
        load: async () => ({}),
      });

      resourceRegistry.register(docs.id, docs);

      assertEquals(resourceRegistry.findByPattern("/docs/v1/page.html"), docs);
      assertEquals(resourceRegistry.findByPattern("/docs/v1/pageXhtml"), undefined);
    });
  });

  describe("extractParams()", () => {
    it("should extract named params from a matching uri", () => {
      assertEquals(
        resourceRegistry.extractParams("/users/42/posts/7", "/users/:userId/posts/:postId"),
        { userId: "42", postId: "7" },
      );
    });

    it("should return an empty object when the uri does not match", () => {
      assertEquals(
        resourceRegistry.extractParams("/users/42/comments/7", "/users/:userId/posts/:postId"),
        {},
      );
    });

    it("should not capture a multi-segment value into a single param", () => {
      assertEquals(
        resourceRegistry.extractParams("/users/a/b/posts/7", "/users/:userId/posts/:postId"),
        {},
        "a multi-segment value must not be captured into a single :param",
      );
    });
  });

  describe("list()", () => {
    it("should return registered resource ids", () => {
      const alpha = resource({
        pattern: "/alpha",
        description: "Alpha",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });
      const beta = resource({
        pattern: "/beta",
        description: "Beta",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });

      resourceRegistry.register(alpha.id, alpha);
      resourceRegistry.register(beta.id, beta);

      assertEquals(resourceRegistry.list().sort(), ["alpha", "beta"]);
    });
  });
});
