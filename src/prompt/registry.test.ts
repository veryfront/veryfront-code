import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertNotStrictEquals, assertThrows } from "#veryfront/testing/assert";
import type { Prompt } from "./types.ts";
import { prompt } from "./factory.ts";
import { promptRegistry, promptRegistryInternal } from "./registry.ts";

describe("prompt registry", () => {
  beforeEach(() => {
    promptRegistryInternal.clearAll();
  });

  afterEach(() => {
    promptRegistryInternal.clearAll();
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

    it("rejects blank definition ids at project and shared registry boundaries", () => {
      for (const id of ["", " ", "\t\n"]) {
        const definition: Prompt = {
          id,
          description: "desc",
          getContent: async () => "Hello",
        };

        for (
          const register of [
            () => promptRegistry.register(id, definition),
            () => promptRegistry.registerShared(id, definition),
          ]
        ) {
          assertThrows(
            register,
            TypeError,
            "Prompt definition id must not be blank",
          );
        }
      }
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

    it("should preserve the receiver of a stateful prompt definition", async () => {
      const state = new WeakMap<object, string>();
      const definition: Prompt = {
        id: "stateful-definition",
        description: "desc",
        async getContent() {
          return state.get(this) ?? "receiver-lost";
        },
      };
      state.set(definition, "receiver-kept");

      promptRegistry.register(definition.id, definition);

      assertEquals(
        await promptRegistry.getContent(definition.id),
        "receiver-kept",
      );
    });

    it("should snapshot MCP metadata for project and shared registrations", () => {
      for (const shared of [false, true]) {
        const id = shared ? "shared-mcp" : "project-mcp";
        const arguments_ = [{ name: "topic", required: true }];
        const mcp = { enabled: true, arguments: arguments_ };
        const definition: Prompt = {
          id,
          description: "desc",
          mcp,
          getContent: async () => "Hello",
        };

        if (shared) {
          promptRegistry.registerShared(id, definition);
        } else {
          promptRegistry.register(id, definition);
        }

        mcp.enabled = false;
        arguments_[0]!.name = "mutated";

        const stored = promptRegistry.get(id);
        assertEquals(stored?.mcp?.enabled, true);
        assertEquals(stored?.mcp?.arguments?.[0]?.name, "topic");
        assertEquals(Object.isFrozen(stored?.mcp), true);
        assertEquals(Object.isFrozen(stored?.mcp?.arguments), true);
      }
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
