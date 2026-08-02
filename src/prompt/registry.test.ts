import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertNotStrictEquals, assertThrows } from "#veryfront/testing/assert";
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

    it("should reject top-level definition accessors without invoking them", () => {
      let reads = 0;
      const definition = Object.freeze(
        Object.defineProperties({}, {
          id: { enumerable: true, value: "hostile" },
          description: {
            enumerable: true,
            get() {
              reads += 1;
              return "desc";
            },
          },
          getContent: { enumerable: true, value: async () => "Hello" },
        }),
      );

      assertThrows(
        () => promptRegistry.register("hostile", definition as unknown as Prompt),
        TypeError,
        "Prompt description must be an own data property",
      );
      assertEquals(reads, 0);
    });

    it("should store an owned immutable definition", () => {
      const definition = Object.freeze({
        id: "owned-definition",
        description: "desc",
        getContent: async () => "Hello",
      });
      promptRegistry.register("owned-definition", definition);

      const stored = promptRegistry.get("owned-definition");
      assertNotStrictEquals(stored, definition);
      assertEquals(Object.isFrozen(stored), true);
    });

    it("should throw when a prompt is missing", () => {
      assertThrows(
        () => promptRegistry.getContent("missing"),
        Error,
        'Prompt "missing" not found',
      );
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
