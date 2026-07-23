import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertThrows } from "#veryfront/testing/assert";
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

    it("prefers a more specific static pattern regardless of registration order", () => {
      const dynamic = resource({
        pattern: "/users/:userId",
        description: "Dynamic user",
        paramsSchema: defineSchema((v) => v.object({ userId: v.string() }))(),
        load: () => ({}),
      });
      const current = resource({
        pattern: "/users/current",
        description: "Current user",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });

      resourceRegistry.register(dynamic.id, dynamic);
      resourceRegistry.register(current.id, current);

      assertEquals(resourceRegistry.findByPattern("/users/current")?.id, current.id);
    });

    it("prefers more literal text when matching patterns have the same parameter count", () => {
      const general = resource({
        id: "general-item",
        pattern: "/items/:id",
        description: "General item",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: () => ({}),
      });
      const special = resource({
        id: "special-item",
        pattern: "/items/special-:id",
        description: "Special item",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: () => ({}),
      });
      resourceRegistry.register(general.id, general);
      resourceRegistry.register(special.id, special);

      assertEquals(resourceRegistry.findByPattern("/items/special-42")?.id, special.id);
    });

    it("uses a registration snapshot instead of mutable caller state", () => {
      const original = resource({
        pattern: "/stable/:id",
        description: "Stable",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: () => ({}),
      });
      const mutable = { ...original };
      resourceRegistry.register(mutable.id, mutable);
      mutable.pattern = "/mutated/:id";

      assertEquals(resourceRegistry.findByPattern("/stable/value")?.id, original.id);
      assertEquals(resourceRegistry.findByPattern("/mutated/value"), undefined);
    });

    it("rejects conflicting duplicate IDs instead of silently replacing resources", () => {
      const first = resource({
        id: "same",
        pattern: "/first",
        description: "First",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });
      const second = resource({
        id: "same",
        pattern: "/second",
        description: "Second",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });
      resourceRegistry.register("same", first);

      assertThrows(() => resourceRegistry.register("same", second), Error);
      assertEquals(resourceRegistry.get("same")?.pattern, "/first");
    });

    it("accepts idempotent local registration", () => {
      const definition = resource({
        id: "same",
        pattern: "/same",
        description: "Same",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });

      resourceRegistry.register(definition.id, definition);
      resourceRegistry.register(definition.id, definition);
      assertEquals(resourceRegistry.get("same")?.pattern, "/same");
    });

    it("rejects a registry id that differs from the definition id", () => {
      const definition = resource({
        id: "definition-id",
        pattern: "/definition-id",
        description: "Definition id",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });

      assertThrows(() => resourceRegistry.register("registry-id", definition), Error);
    });

    it("rejects unreadable resource definitions at the registry boundary", () => {
      const definition = resource({
        id: "unreadable",
        pattern: "/unreadable",
        description: "Unreadable",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });
      const unreadable = Object.defineProperty({ ...definition }, "description", {
        get() {
          throw new Error("unreadable description");
        },
      });

      assertThrows(
        () => resourceRegistry.register(definition.id, unreadable as never),
        Error,
      );
      assertThrows(() => resourceRegistry.register("invalid", null as never), Error);
    });

    it("rejects structurally ambiguous parameter patterns", () => {
      const byId = resource({
        pattern: "/users/:id",
        description: "By id",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: () => ({}),
      });
      const byName = resource({
        pattern: "/users/:name",
        description: "By name",
        paramsSchema: defineSchema((v) => v.object({ name: v.string() }))(),
        load: () => ({}),
      });
      resourceRegistry.register(byId.id, byId);

      assertThrows(() => resourceRegistry.register(byName.id, byName), Error);
    });

    it("rejects overlapping patterns with equal specificity", () => {
      const left = resource({
        id: "left",
        pattern: "/a/:left/c",
        description: "Left",
        paramsSchema: defineSchema((v) => v.object({ left: v.string() }))(),
        load: () => ({}),
      });
      const right = resource({
        id: "right",
        pattern: "/a/b/:right",
        description: "Right",
        paramsSchema: defineSchema((v) => v.object({ right: v.string() }))(),
        load: () => ({}),
      });
      resourceRegistry.register(left.id, left);

      assertThrows(() => resourceRegistry.register(right.id, right), Error);
    });

    it("does not confuse a literal colon with a dynamic placeholder", () => {
      const literal = resource({
        id: "literal-colon",
        pattern: "/users/:",
        description: "Literal colon",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });
      const dynamic = resource({
        id: "dynamic-user",
        pattern: "/users/:id",
        description: "Dynamic user",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: () => ({}),
      });

      resourceRegistry.register(literal.id, literal);
      resourceRegistry.register(dynamic.id, dynamic);
      assertEquals(resourceRegistry.findByPattern("/users/:")?.id, literal.id);
    });

    it("requires a real URI pattern before direct registration", () => {
      const undiscovered = resource({
        description: "Undiscovered",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });

      assertThrows(
        () => resourceRegistry.register(undiscovered.id, undiscovered),
        Error,
      );
    });

    it("accepts a generated definition after discovery supplies its identity", () => {
      const undiscovered = resource({
        description: "Discovered",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: () => ({}),
      });
      const discovered = {
        ...undiscovered,
        id: "discovered-resource",
        pattern: "/discovered/:id",
      };

      resourceRegistry.register(discovered.id, discovered);
      assertEquals(
        resourceRegistry.findByPattern("/discovered/value")?.id,
        "discovered-resource",
      );
    });

    it("rejects conflicting shared resource identities", () => {
      const first = resource({
        id: "shared",
        pattern: "/shared/first",
        description: "First",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });
      const conflicting = resource({
        id: "shared",
        pattern: "/shared/second",
        description: "Second",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });
      resourceRegistry.registerShared(first.id, first);

      assertThrows(
        () => resourceRegistry.registerShared(conflicting.id, conflicting),
        Error,
      );
      assertEquals(resourceRegistry.getShared("shared")?.pattern, "/shared/first");
    });

    it("accepts idempotent shared registration", () => {
      const shared = resource({
        id: "shared",
        pattern: "/shared",
        description: "Shared",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: () => ({}),
      });

      resourceRegistry.registerShared(shared.id, shared);
      resourceRegistry.registerShared(shared.id, shared);
      assertEquals(resourceRegistry.getShared("shared")?.pattern, "/shared");
    });
  });

  describe("extractParams()", () => {
    it("should extract named params from a matching uri", () => {
      assertEquals(
        resourceRegistry.extractParams("/users/42/posts/7", "/users/:userId/posts/:postId"),
        { userId: "42", postId: "7" },
      );
    });

    it("decodes URI parameter values without treating encoded slashes as path separators", () => {
      assertEquals(
        resourceRegistry.extractParams(
          "/users/Alice%20Smith/files/a%2Fb",
          "/users/:name/files/:file",
        ),
        { name: "Alice Smith", file: "a/b" },
      );
    });

    it("preserves inline parameter placeholders supported by existing patterns", () => {
      assertEquals(
        resourceRegistry.extractParams("/files/report.json", "/files/:name.json"),
        { name: "report" },
      );
    });

    it("keeps prototype-like parameter names as inert own properties", () => {
      const params = resourceRegistry.extractParams(
        "/values/first/second",
        "/values/:__proto__/:constructor",
      );

      assertEquals(Object.getPrototypeOf(params), null);
      assertEquals(params.__proto__, "first");
      assertEquals(params["constructor"], "second");
    });

    it("rejects malformed URI encoding", () => {
      assertThrows(
        () => resourceRegistry.extractParams("/users/%ZZ", "/users/:name"),
        Error,
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

  describe("toUriTemplate()", () => {
    it("renders compiler-recognized parameters as URI-template expressions", () => {
      assertEquals(
        resourceRegistry.toUriTemplate("resource://items/:id/files/:name.json"),
        "resource://items/{id}/files/{name}.json",
      );
    });

    it("does not treat opaque URI colons as resource parameters", () => {
      assertEquals(resourceRegistry.toUriTemplate("urn:example:animal:ferret:nose"), undefined);
    });
  });
});
