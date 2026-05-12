import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertThrows } from "#veryfront/testing/assert";
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
