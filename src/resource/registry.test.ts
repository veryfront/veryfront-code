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

    it("should prefer an exact resource over an earlier parameterized match", () => {
      const userById = resource({
        pattern: "/users/:userId",
        description: "User by id",
        paramsSchema: defineSchema((v) => v.object({ userId: v.string() }))(),
        load: async () => ({}),
      });
      const currentUser = resource({
        pattern: "/users/me",
        description: "Current user",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });

      resourceRegistry.register(userById.id, userById);
      resourceRegistry.register(currentUser.id, currentUser);

      assertEquals(resourceRegistry.findByPattern("/users/me"), currentUser);
    });

    it("should treat opaque URI scheme values as literals", () => {
      const isbn = resource({
        pattern: "urn:isbn",
        description: "ISBN namespace",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });

      resourceRegistry.register(isbn.id, isbn);

      assertEquals(resourceRegistry.findByPattern("urn:isbn"), isbn);
      assertEquals(resourceRegistry.findByPattern("urn:other"), undefined);

      const ietf = resource({
        pattern: "urn:ietf:params",
        description: "IETF parameters namespace",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });
      resourceRegistry.register(ietf.id, ietf);
      assertEquals(resourceRegistry.findByPattern("urn:ietf:params"), ietf);
      assertEquals(resourceRegistry.findByPattern("urn:ietf:anything"), undefined);

      const punctuated = resource({
        pattern: "urn:ietf_:xml",
        description: "Punctuated IETF namespace",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });
      resourceRegistry.register(punctuated.id, punctuated);
      assertEquals(resourceRegistry.findByPattern("urn:ietf_:xml"), punctuated);
      assertEquals(resourceRegistry.findByPattern("urn:ietf_anything"), undefined);

      const custom = resource({
        pattern: "custom:namespace/path:literal",
        description: "Opaque custom namespace",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });
      resourceRegistry.register(custom.id, custom);
      assertEquals(resourceRegistry.findByPattern("custom:namespace/path:literal"), custom);
      assertEquals(resourceRegistry.findByPattern("custom:namespace/pathanything"), undefined);
    });

    it("should match multiple parameters within one path segment", () => {
      const file = resource({
        pattern: "/files/:base.:ext",
        description: "File by name",
        paramsSchema: defineSchema((v) => v.object({ base: v.string(), ext: v.string() }))(),
        load: async () => ({}),
      });

      resourceRegistry.register(file.id, file);

      assertEquals(resourceRegistry.findByPattern("/files/report.pdf"), file);
      assertEquals(
        resourceRegistry.extractParams("/files/report.pdf", file.pattern),
        { base: "report", ext: "pdf" },
      );
    });

    it("should match parameters in rootless hierarchical URI paths", () => {
      const item = resource({
        pattern: "custom:collection/:id",
        description: "Collection item",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: async () => ({}),
      });
      resourceRegistry.register(item.id, item);

      assertEquals(resourceRegistry.findByPattern("custom:collection/42"), item);
      assertEquals(
        resourceRegistry.extractParams("custom:collection/42", item.pattern),
        { id: "42" },
      );
    });

    it("should support caller-scoped visibility without changing default lookup", () => {
      const userById = resource({
        pattern: "/users/:userId",
        description: "User by id",
        paramsSchema: defineSchema((v) => v.object({ userId: v.string() }))(),
        load: async () => ({}),
      });
      const disabledCurrentUser = resource({
        pattern: "/users/me",
        description: "Disabled current user",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
        mcp: { enabled: false },
      });

      resourceRegistry.register(userById.id, userById);
      resourceRegistry.register(disabledCurrentUser.id, disabledCurrentUser);

      assertEquals(resourceRegistry.findByPattern("/users/me"), disabledCurrentUser);
      assertEquals(
        resourceRegistry.findByPattern(
          "/users/me",
          (candidate) => candidate.mcp?.enabled !== false,
        ),
        userById,
      );
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
