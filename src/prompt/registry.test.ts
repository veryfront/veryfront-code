import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
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

    it("should forward render cancellation context", async () => {
      const abortController = new AbortController();
      let receivedSignal: AbortSignal | undefined;
      promptRegistry.register(
        "context",
        prompt({
          id: "context",
          description: "desc",
          generate: (_variables, context) => {
            receivedSignal = context?.abortSignal;
            return "ok";
          },
        }),
      );

      assertEquals(
        await promptRegistry.getContent(
          "context",
          {},
          { abortSignal: abortController.signal },
        ),
        "ok",
      );
      assertEquals(receivedSignal, abortController.signal);
    });

    it("should return a rejected promise when a prompt is missing", async () => {
      await assertRejects(
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

  it("does not expose process-wide registry capabilities", () => {
    const publicRegistry = promptRegistry as unknown as Record<string, unknown>;
    assertEquals(publicRegistry.registerShared, undefined);
    assertEquals(publicRegistry.clearAll, undefined);
    assertEquals(publicRegistry.getStats, undefined);
    assertEquals("registerShared" in publicRegistry, false);
    assertEquals("clearAll" in publicRegistry, false);
    assertEquals("getStats" in publicRegistry, false);
  });

  it("rejects mismatched ids and snapshots literal MCP metadata", () => {
    const mcp = {
      title: "Original",
      arguments: [{ name: "topic", required: true }],
    };
    const literal = {
      id: "literal",
      description: "Literal prompt",
      mcp,
      getContent: () => Promise.resolve("ok"),
    };

    assertThrows(
      () => promptRegistry.register("alias", literal),
      TypeError,
      'Prompt registry id "alias" does not match definition id "literal"',
    );
    promptRegistry.register("literal", literal);
    mcp.title = "Mutated";
    mcp.arguments[0]!.name = "changed";

    assertEquals(promptRegistry.get("literal")?.mcp, {
      title: "Original",
      enabled: undefined,
      arguments: [{
        name: "topic",
        title: undefined,
        description: undefined,
        required: true,
      }],
    });
  });
});
