import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeToolDiscoveryContext } from "./tool-discovery-context.ts";
import { createLoadToolsTool, type LoadToolsToolOptions } from "./load-tools-tool.ts";

const AUTHORIZED_TOOLS = ["read_file", "write_file", "search_code", "update_agent"] as const;

function makeContext(initial: string[] = []): RuntimeToolDiscoveryContext {
  return {
    activatedRemoteToolNames: new Set(initial),
  };
}

function makeOptions(
  context: RuntimeToolDiscoveryContext,
  overrides: Partial<Omit<LoadToolsToolOptions, "context">> = {},
): LoadToolsToolOptions {
  return {
    context,
    pinnedToolNames: ["load_skill", "search_tools", "load_tools"],
    model: "anthropic/claude-sonnet-4-6",
    getAuthorizedToolNames: () => [...AUTHORIZED_TOOLS],
    ...overrides,
  };
}

describe("load_tools tool", () => {
  describe("validation", () => {
    it("rejects unknown tool names with unknown_tool reason", async () => {
      const context = makeContext();
      const tool = createLoadToolsTool(makeOptions(context));
      const result = await tool.execute({ names: ["nonexistent_tool"] });

      assertEquals("error" in result, true);
      if ("error" in result) {
        assertEquals(result.reasons["nonexistent_tool"], "unknown_tool");
      }
    });

    it("rejects unauthorized names with same unknown_tool reason (no info leakage)", async () => {
      const context = makeContext();
      const tool = createLoadToolsTool(
        makeOptions(context, {
          getAuthorizedToolNames: () => ["read_file"],
        }),
      );
      // write_file exists in some catalog but is not authorized for this run
      const result = await tool.execute({ names: ["write_file"] });

      assertEquals("error" in result, true);
      if ("error" in result) {
        assertEquals(result.reasons["write_file"], "unknown_tool");
      }
    });

    it("rejects atomically: one bad name fails the whole call", async () => {
      const context = makeContext();
      const tool = createLoadToolsTool(makeOptions(context));
      const result = await tool.execute({ names: ["read_file", "bad_tool"] });

      assertEquals("error" in result, true);
      // read_file should NOT be activated (atomic failure)
      assertEquals(context.activatedRemoteToolNames?.has("read_file"), false);
    });

    it("returns per-name reasons for each rejected name", async () => {
      const context = makeContext();
      const tool = createLoadToolsTool(makeOptions(context));
      const result = await tool.execute({
        names: ["nonexistent_a", "nonexistent_b"],
      });

      assertEquals("error" in result, true);
      if ("error" in result) {
        assertEquals(result.reasons["nonexistent_a"], "unknown_tool");
        assertEquals(result.reasons["nonexistent_b"], "unknown_tool");
      }
    });
  });

  describe("successful activation", () => {
    it("activates valid tools and adds them to the context set", async () => {
      const context = makeContext();
      const tool = createLoadToolsTool(makeOptions(context));
      const result = await tool.execute({ names: ["read_file", "write_file"] });

      assertEquals("activated" in result, true);
      if ("activated" in result) {
        assertEquals(result.activated.sort(), ["read_file", "write_file"]);
      }
      assertEquals(context.activatedRemoteToolNames?.has("read_file"), true);
      assertEquals(context.activatedRemoteToolNames?.has("write_file"), true);
    });

    it("is idempotent: already-activated tools count as success", async () => {
      const context = makeContext(["read_file"]);
      const tool = createLoadToolsTool(makeOptions(context));
      const result = await tool.execute({ names: ["read_file"] });

      assertEquals("activated" in result, true);
      if ("activated" in result) {
        assertEquals(result.activated, ["read_file"]);
      }
    });

    it("only reports newly-activated names (not already-activated duplicates)", async () => {
      const context = makeContext(["read_file"]);
      const tool = createLoadToolsTool(makeOptions(context));
      const result = await tool.execute({ names: ["read_file", "write_file"] });

      assertEquals("activated" in result, true);
      if ("activated" in result) {
        // read_file was already active; only write_file is newly activated
        assertEquals(result.newlyActivated, ["write_file"]);
        assertEquals(result.activated.sort(), ["read_file", "write_file"]);
      }
    });

    it("calls onToolsActivated with newly-activated names only", async () => {
      const context = makeContext(["read_file"]);
      const activated: string[][] = [];
      context.onToolsActivated = (names) => activated.push(names);

      const tool = createLoadToolsTool(makeOptions(context));
      await tool.execute({ names: ["read_file", "write_file"] });

      assertEquals(activated, [["write_file"]]);
    });

    it("does not call onToolsActivated when all names are already active", async () => {
      const context = makeContext(["read_file"]);
      let called = false;
      context.onToolsActivated = () => {
        called = true;
      };

      const tool = createLoadToolsTool(makeOptions(context));
      await tool.execute({ names: ["read_file"] });

      assertEquals(called, false);
    });
  });

  describe("budget enforcement", () => {
    it("refuses when pinned + activated + new would exceed provider budget (OpenAI 128)", async () => {
      // Simulate OpenAI 128-tool cap.
      // pinned = 3 (load_skill, search_tools, load_tools)
      // already activated = 125
      // trying to add 1 more would hit exactly 129 > 128
      const existing = Array.from({ length: 125 }, (_, i) => `tool_${i}`);
      const context = makeContext(existing);
      // authorized catalog must include those existing + the new one
      const authorized = [...existing, "new_tool_a", "new_tool_b"];
      const tool = createLoadToolsTool(
        makeOptions(context, {
          model: "openai/gpt-4.1",
          getAuthorizedToolNames: () => authorized,
        }),
      );
      const result = await tool.execute({ names: ["new_tool_a"] });

      assertEquals("error" in result, true);
      if ("error" in result) {
        assertStringIncludes(result.error, "overflow");
        // overflow = (3 + 125 + 1) - 128 = 1
        assertStringIncludes(result.error, "1");
      }
      // not activated
      assertEquals(context.activatedRemoteToolNames?.has("new_tool_a"), false);
    });

    it("reports exact overflow count", async () => {
      // pinned = 3, activated = 124, adding 3 more = 130 > 128, overflow = 2
      const existing = Array.from({ length: 124 }, (_, i) => `tool_${i}`);
      const context = makeContext(existing);
      const authorized = [...existing, "tool_a", "tool_b", "tool_c"];
      const tool = createLoadToolsTool(
        makeOptions(context, {
          model: "openai/gpt-4.1",
          getAuthorizedToolNames: () => authorized,
        }),
      );
      const result = await tool.execute({ names: ["tool_a", "tool_b", "tool_c"] });

      assertEquals("error" in result, true);
      if ("error" in result) {
        assertStringIncludes(result.error, "2");
      }
    });

    it("allows activation up to exactly the provider budget", async () => {
      // pinned = 3, activated = 124, adding 1 = 128 exactly, no overflow
      const existing = Array.from({ length: 124 }, (_, i) => `tool_${i}`);
      const context = makeContext(existing);
      const authorized = [...existing, "tool_ok"];
      const tool = createLoadToolsTool(
        makeOptions(context, {
          model: "openai/gpt-4.1",
          getAuthorizedToolNames: () => authorized,
        }),
      );
      const result = await tool.execute({ names: ["tool_ok"] });

      assertEquals("activated" in result, true);
    });

    it("does not enforce a budget cap for uncapped providers", async () => {
      // anthropic has no maxTools
      const existing = Array.from({ length: 200 }, (_, i) => `tool_${i}`);
      const context = makeContext(existing);
      const authorized = [...existing, "extra_tool"];
      const tool = createLoadToolsTool(
        makeOptions(context, {
          model: "anthropic/claude-sonnet-4-6",
          getAuthorizedToolNames: () => authorized,
        }),
      );
      const result = await tool.execute({ names: ["extra_tool"] });

      assertEquals("activated" in result, true);
    });

    it("does not evict existing activations on overflow (never-evict policy)", async () => {
      const existing = Array.from({ length: 125 }, (_, i) => `tool_${i}`);
      const context = makeContext(existing);
      const authorized = [...existing, "new_one"];
      const tool = createLoadToolsTool(
        makeOptions(context, {
          model: "openai/gpt-4.1",
          getAuthorizedToolNames: () => authorized,
        }),
      );
      await tool.execute({ names: ["new_one"] });

      // All original activations must still be present
      for (const name of existing) {
        assertEquals(context.activatedRemoteToolNames?.has(name), true);
      }
    });

    it("calls onToolsActivationRejected on overflow", async () => {
      const existing = Array.from({ length: 126 }, (_, i) => `tool_${i}`);
      const context = makeContext(existing);
      const rejected: Array<{ names: string[]; reasons: Record<string, string> }> = [];
      context.onToolsActivationRejected = (names, reasons) => rejected.push({ names, reasons });
      const authorized = [...existing, "overflow_tool"];
      const tool = createLoadToolsTool(
        makeOptions(context, {
          model: "openai/gpt-4.1",
          getAuthorizedToolNames: () => authorized,
        }),
      );
      await tool.execute({ names: ["overflow_tool"] });

      assertEquals(rejected.length, 1);
      assertEquals(rejected[0].names, ["overflow_tool"]);
    });
  });

  describe("tool metadata", () => {
    it("has the correct tool id", () => {
      const tool = createLoadToolsTool(makeOptions(makeContext()));
      assertEquals(tool.id, "load_tools");
    });

    it("has a static input schema (no enum narrowing)", () => {
      const tool = createLoadToolsTool(makeOptions(makeContext()));
      const schema = tool.inputSchemaJson;
      // names must be a plain string array, not an enum-constrained list
      assertEquals(
        (schema as Record<string, unknown>).type,
        "object",
      );
    });
  });
});
