import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import type { Prompt } from "./types.ts";
import { prompt } from "./factory.ts";
import { promptRegistry } from "./registry.ts";

describe("prompt registry", () => {
  beforeEach(() => {
    promptRegistry.clearAll();
  });

  afterEach(() => {
    promptRegistry.clearAll();
  });

  describe("getContent()", () => {
    it("should resolve content from a registered prompt", async () => {
      promptRegistry.register(
        "welcome",
        prompt({
          id: "welcome",
          description: "desc",
          content: "Hello {name}",
        }),
      );

      assertEquals(await promptRegistry.getContent("welcome", { name: "Alice" }), "Hello Alice");
    });

    it("should throw when a prompt is missing", () => {
      assertThrows(
        () => promptRegistry.getContent("missing"),
        Error,
        'Prompt "missing" not found',
      );
    });

    it("validates custom prompt output at the registry boundary", async () => {
      promptRegistry.register("invalid-output", {
        id: "invalid-output",
        description: "desc",
        getContent: (() => Promise.resolve(42)) as never,
      });

      await assertRejects(
        () => promptRegistry.getContent("invalid-output"),
        Error,
      );
    });
  });

  describe("registration", () => {
    it("rejects malformed definitions and mismatched IDs", () => {
      assertThrows(
        () => promptRegistry.register("expected", null as never),
        Error,
      );
      assertThrows(
        () =>
          promptRegistry.register("missing-renderer", {
            id: "missing-renderer",
            description: "desc",
          } as never),
        Error,
      );
      assertThrows(
        () =>
          promptRegistry.register("expected", {
            id: "different",
            description: "desc",
            getContent: () => Promise.resolve("content"),
          }),
        Error,
      );
    });

    it("stores immutable snapshots instead of mutable caller objects", async () => {
      const definition: Prompt = {
        id: "snapshot",
        description: "Original",
        suggestion: "Original suggestion",
        arguments: [{ name: "value", description: "Original argument" }],
        getContent: () => Promise.resolve("Original content"),
      };

      promptRegistry.register("snapshot", definition);
      definition.description = "Changed";
      definition.suggestion = "Changed";
      definition.arguments![0]!.description = "Changed";
      definition.getContent = () => Promise.resolve("Changed content");

      const stored = promptRegistry.get("snapshot");
      assert(stored !== undefined && Object.isFrozen(stored));
      assertEquals(stored.description, "Original");
      assertEquals(stored.suggestion, "Original suggestion");
      assertEquals(stored.arguments, [{
        name: "value",
        description: "Original argument",
        required: false,
      }]);
      assertEquals(await stored.getContent(), "Original content");
    });

    it("rejects conflicting duplicate definitions but permits idempotent registration", () => {
      const definition = prompt({
        id: "duplicate",
        description: "First",
        content: "First",
      });
      promptRegistry.register("duplicate", definition);
      promptRegistry.register("duplicate", definition);

      assertThrows(
        () =>
          promptRegistry.register(
            "duplicate",
            prompt({
              id: "duplicate",
              description: "Second",
              content: "Second",
            }),
          ),
        Error,
      );
    });

    it("reuses snapshots for repeated custom and shared registration", () => {
      const custom: Prompt = {
        id: "custom",
        description: "Custom",
        getContent: () => Promise.resolve("Custom"),
      };
      promptRegistry.register("custom", custom);
      promptRegistry.register("custom", custom);

      const shared: Prompt = {
        id: "shared",
        description: "Shared",
        getContent: () => Promise.resolve("Shared"),
      };
      promptRegistry.registerShared("shared", shared);
      promptRegistry.registerShared("shared", shared);

      assertEquals(promptRegistry.has("custom"), true);
      assertEquals(promptRegistry.hasShared("shared"), true);
    });
  });

  describe("list()", () => {
    it("should return registered prompt ids", () => {
      promptRegistry.register(
        "alpha",
        prompt({
          id: "alpha",
          description: "desc",
          content: "Alpha",
        }),
      );
      promptRegistry.register(
        "beta",
        prompt({
          id: "beta",
          description: "desc",
          content: "Beta",
        }),
      );

      assertEquals(promptRegistry.list().sort(), ["alpha", "beta"]);
    });
  });
});
