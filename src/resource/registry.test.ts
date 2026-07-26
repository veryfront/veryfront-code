import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { runWithRegistryTransaction } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { resource } from "./factory.ts";
import { resourceRegistry, resourceRegistryInternal } from "./registry.ts";

describe("resource registry", () => {
  beforeEach(() => {
    resourceRegistryInternal.clearAll();
  });

  afterEach(() => {
    resourceRegistryInternal.clearAll();
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

      assertEquals(resourceRegistry.findByPattern("/users/42/posts/7") === userPosts, true);
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

      assertEquals(resourceRegistry.findByPattern("/docs/v1/page.html") === docs, true);
      assertEquals(resourceRegistry.findByPattern("/docs/v1/pageXhtml"), undefined);
    });

    it("should prefer an exact resource over an earlier dynamic match", () => {
      const dynamic = resource({
        pattern: "/users/:id",
        description: "Dynamic user",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: async () => ({}),
      });
      const exact = resource({
        pattern: "/users/me",
        description: "Current user",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });

      resourceRegistry.register(dynamic.id, dynamic);
      resourceRegistry.register(exact.id, exact);

      assertEquals(resourceRegistry.findByPattern("/users/me") === exact, true);
    });

    it("should not alias query or fragment variants into path parameters", () => {
      const user = resource({
        pattern: "/users/:id",
        description: "User",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: ({ id }) => ({ id }),
      });
      resourceRegistry.register(user.id, user);

      assertEquals(resourceRegistry.findByPattern("/users/42?view=full"), undefined);
      assertEquals(resourceRegistry.findByPattern("/users/42#profile"), undefined);
      assertEquals(resourceRegistry.findByPattern("/users/42%3Fview%3Dfull"), user);
      assertEquals(
        resourceRegistry.extractParams("/users/42%3Fview%3Dfull", user.pattern),
        { id: "42?view=full" },
      );
    });

    it("should preserve complete exact URI identity", () => {
      const summary = resource({
        pattern: "docs://project?view=summary",
        description: "Project summary",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });
      resourceRegistry.register(summary.id, summary);

      assertEquals(
        resourceRegistry.findByPattern("docs://project?view=summary"),
        summary,
      );
      assertEquals(resourceRegistry.findByPattern("docs://project"), undefined);
      assertEquals(
        resourceRegistry.findByPattern("docs://project?view=full"),
        undefined,
      );
    });

    it("should reject unbounded or raw-whitespace URIs before matching", () => {
      const user = resource({
        pattern: "/users/:id",
        description: "User",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: ({ id }) => ({ id }),
      });
      resourceRegistry.register(user.id, user);

      assertThrows(
        () => resourceRegistry.findByPattern("/users/raw value"),
        Error,
        "raw whitespace",
      );
      assertThrows(
        () => resourceRegistry.findByPattern(`/users/${"x".repeat(8 * 1024)}`),
        Error,
        "8192",
      );
      assertEquals(resourceRegistry.findByPattern("/users/encoded%20value"), user);
    });

    it("should reject ambiguous patterns instead of depending on registration order", () => {
      const byId = resource({
        pattern: "/users/:id",
        description: "User by id",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: async () => ({}),
      });
      const byName = resource({
        pattern: "/users/:name",
        description: "User by name",
        paramsSchema: defineSchema((v) => v.object({ name: v.string() }))(),
        load: async () => ({}),
      });

      resourceRegistry.register(byId.id, byId);
      assertThrows(
        () => resourceRegistry.register(byName.id, byName),
        Error,
        'conflicts with registered resource "users_id"',
      );
    });

    it("rejects an ambiguous pattern introduced by a concurrent live registration", async () => {
      const byId = resource({
        pattern: "/users/:id",
        description: "User by id",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: async () => ({}),
      });
      const byName = resource({
        pattern: "/users/:name",
        description: "User by name",
        paramsSchema: defineSchema((v) => v.object({ name: v.string() }))(),
        load: async () => ({}),
      });
      const stageReady = Promise.withResolvers<void>();
      const releaseStage = Promise.withResolvers<void>();

      const transaction = runWithRegistryTransaction(async () => {
        resourceRegistry.clear();
        resourceRegistry.register(byId.id, byId);
        stageReady.resolve();
        await releaseStage.promise;
      });

      await stageReady.promise;
      resourceRegistry.register(byName.id, byName);
      releaseStage.resolve();

      await assertRejects(
        () => transaction,
        Error,
        'conflicts with registered resource "users_id"',
      );
      assertEquals(resourceRegistry.get(byId.id), undefined);
      assertEquals(resourceRegistry.get(byName.id), byName);
    });

    it("rejects an ambiguous pattern introduced by a concurrent shared registration", async () => {
      const byId = resource({
        pattern: "/accounts/:id",
        description: "Account by id",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: async () => ({}),
      });
      const byName = resource({
        pattern: "/accounts/:name",
        description: "Account by name",
        paramsSchema: defineSchema((v) => v.object({ name: v.string() }))(),
        load: async () => ({}),
      });
      const stageReady = Promise.withResolvers<void>();
      const releaseStage = Promise.withResolvers<void>();

      const transaction = runWithRegistryTransaction(async () => {
        resourceRegistry.clear();
        resourceRegistry.register(byId.id, byId);
        stageReady.resolve();
        await releaseStage.promise;
      });

      await stageReady.promise;
      resourceRegistryInternal.registerShared(byName.id, byName);
      releaseStage.resolve();

      await assertRejects(
        () => transaction,
        Error,
        'conflicts with registered resource "accounts_name"',
      );
      assertEquals(resourceRegistry.get(byId.id), undefined);
      assertEquals(resourceRegistry.get(byName.id), byName);
    });

    it("should reject templates whose wildcard positions overlap", () => {
      const userById = resource({
        pattern: "/users/:id",
        description: "User by id",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: async () => ({}),
      });
      const collectionMember = resource({
        pattern: "/:collection/me",
        description: "Current collection member",
        paramsSchema: defineSchema((v) => v.object({ collection: v.string() }))(),
        load: async () => ({}),
      });

      resourceRegistry.register(userById.id, userById);
      assertThrows(
        () => resourceRegistry.register(collectionMember.id, collectionMember),
        Error,
        'conflicts with registered resource "users_id"',
      );
    });

    it("should reject derived-id collisions with different patterns", () => {
      const nested = resource({
        pattern: "/a/b",
        description: "Nested",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });
      const underscored = resource({
        pattern: "/a_b",
        description: "Underscored",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });

      resourceRegistry.register(nested.id, nested);
      assertThrows(
        () => resourceRegistry.register(underscored.id, underscored),
        Error,
        'resource id "a_b" is already registered for pattern "/a/b"',
      );
    });

    it("should reject raw URI-template braces", () => {
      assertThrows(
        () =>
          resource({
            pattern: "/users/{id}",
            description: "Invalid template syntax",
            paramsSchema: defineSchema((v) => v.object({}))(),
            load: async () => ({}),
          }),
        Error,
        "raw URI-template braces are not allowed",
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

    it("should decode percent-encoded parameter values", () => {
      assertEquals(
        resourceRegistry.extractParams("/users/Alice%20Smith", "/users/:name"),
        { name: "Alice Smith" },
      );
    });

    it("should reject malformed percent-encoding", () => {
      assertThrows(
        () => resourceRegistry.extractParams("/users/%E0%A4%A", "/users/:name"),
        Error,
        'invalid percent-encoding for parameter "name"',
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

  describe("registration boundary", () => {
    it("should validate and transform params for literal resource definitions", async () => {
      let received = "";
      resourceRegistry.register("literal", {
        id: "literal",
        pattern: "/literal/:value",
        description: "Literal",
        paramsSchema: defineSchema((v) =>
          v.object({
            value: v.string().transform((value) => `${value}!`),
          })
        )(),
        load: ({ value }) => {
          received = value;
          return value;
        },
      });

      const registered = resourceRegistry.get("literal");
      assertEquals(await registered?.load({ value: "ready" }), "ready!");
      assertEquals(received, "ready!");
      await assertRejects(
        () => registered!.load({ value: 42 } as never),
        Error,
        "params validation failed",
      );
    });

    it("should snapshot and freeze a registered definition", async () => {
      const definition = {
        id: "stable",
        pattern: "/stable",
        description: "Stable",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => "original",
        mcp: {
          enabled: true,
          content: { type: "text" as const, mimeType: "text/plain" },
        },
      };
      resourceRegistry.register("stable", definition);

      definition.pattern = "/mutated";
      definition.load = () => "mutated";
      definition.mcp.enabled = false;
      definition.mcp.content.mimeType = "text/html";

      const registered = resourceRegistry.get("stable");
      assertEquals(Object.isFrozen(registered), true);
      assertEquals(registered?.pattern, "/stable");
      assertEquals(registered?.mcp, {
        enabled: true,
        content: { type: "text", mimeType: "text/plain" },
      });
      assertEquals(await registered?.load({}), "original");
    });

    it("should reject malformed literal definitions", () => {
      assertThrows(
        () =>
          resourceRegistry.register("invalid", {
            id: "invalid",
            pattern: "/invalid",
            description: "Invalid",
            paramsSchema: {} as never,
            load: () => ({}),
          }),
        TypeError,
        "paramsSchema.parse must be a function",
      );
    });
  });
});
