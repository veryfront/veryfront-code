import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { normalizeBashToolSet, renameSandboxFileTools } from "./shell-tools.ts";

describe("sandbox/shell-tools", () => {
  it("renames bash-tool file tools to sandbox-scoped names", () => {
    const tools = renameSandboxFileTools({
      bash: { description: "run bash" },
      readFile: { description: "read" },
      writeFile: { description: "write" },
      other_tool: { description: "custom" },
    });

    assertExists(tools.bash);
    assertStringIncludes(String(tools.bash.description), "sandbox /workspace environment");
    assertExists(tools.sandbox_read_file);
    assertStringIncludes(
      String(tools.sandbox_read_file.description),
      "sandbox /workspace filesystem only",
    );
    assertExists(tools.sandbox_write_file);
    assertStringIncludes(
      String(tools.sandbox_write_file.description),
      "sandbox /workspace filesystem only",
    );
    assertEquals(tools.readFile, undefined);
    assertEquals(tools.writeFile, undefined);
    assertEquals(tools.other_tool?.description, "custom");
  });

  it("does not mutate the input tool set", () => {
    const tools = {
      readFile: { description: "read" },
      bash: { description: "bash" },
    };

    renameSandboxFileTools(tools);

    assertExists(tools.readFile);
    assertEquals(tools.bash.description, "bash");
  });

  it("normalizes bash-tool definitions from unknown objects", async () => {
    let receivedToolCallId = "";
    const normalized = normalizeBashToolSet({
      bash: {
        id: "bash",
        type: "function",
        description: "Run commands",
        inputSchema: { parse: (input: unknown) => input },
        inputSchemaJson: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
          required: ["command"],
        },
        execute: (_input: unknown, context?: { toolCallId?: string }) => {
          receivedToolCallId = context?.toolCallId ?? "";
          return { ok: true };
        },
      },
    });

    assertEquals(normalized.bash?.id, "bash");
    assertEquals(normalized.bash?.type, "function");
    assertEquals(normalized.bash?.description, "Run commands");
    assertEquals(normalized.bash?.inputSchemaJson, {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
    });
    assertEquals(await normalized.bash?.execute?.({}, { toolCallId: "call_123" }), { ok: true });
    assertEquals(receivedToolCallId, "call_123");
  });

  it("handles invalid definitions gracefully", () => {
    assertEquals(normalizeBashToolSet({ bad: "not-an-object" }), { bad: {} });
    assertEquals(normalizeBashToolSet({ bad: null }), { bad: {} });
    assertEquals(normalizeBashToolSet({ tool: { inputSchemaJson: "bad" } }), { tool: {} });
  });
});
