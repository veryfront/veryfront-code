import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { defineSchema } from "#veryfront/schemas/index.ts";
import {
  createSandboxShellTools,
  normalizeBashToolSet,
  renameSandboxFileTools,
} from "./shell-tools.ts";
import { toolToProviderDefinition } from "#veryfront/tool/registry.ts";

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

  it("creates sandbox shell tools with an injected bash-tool factory", async () => {
    const tools = await createSandboxShellTools(
      {
        executeCommand: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }),
        readFile: async () => "content",
        writeFiles: async () => undefined,
      },
      async (input) => {
        assertEquals(input.destination, "/workspace");
        assertStringIncludes(input.promptOptions.toolPrompt, "agent-browser");
        return {
          tools: {
            readFile: { description: "read" },
            writeFile: { description: "write" },
          },
        };
      },
    );

    assertExists(tools.sandbox_read_file);
    assertExists(tools.sandbox_write_file);
    assertEquals(tools.readFile, undefined);
    assertEquals(tools.writeFile, undefined);
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

  it("uses the tool map key when bash-tool definitions omit an id", () => {
    const normalized = normalizeBashToolSet({
      bash: {
        description: "Run commands",
        inputSchemaJson: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
        },
      },
    });

    assertEquals(normalized.bash?.id, "bash");
  });

  it("provides provider-safe JSON schema for bash-tool schemas without inputSchemaJson", () => {
    const normalized = normalizeBashToolSet({
      bash: {
        description: "Run commands",
        inputSchema: { parse: (input: unknown) => input },
        execute: () => ({ ok: true }),
      },
    });

    assertEquals(normalized.bash?.inputSchemaJson, {
      type: "object",
      properties: {},
      additionalProperties: true,
    });
    assertEquals(toolToProviderDefinition(normalized.bash as never).parameters, {
      type: "object",
      properties: {},
      additionalProperties: true,
    });
  });

  it("keeps defineSchema input schemas on the normal conversion path", () => {
    const inputSchema = defineSchema((v) =>
      v.object({
        command: v.string(),
      })
    )();
    const normalized = normalizeBashToolSet({
      bash: {
        description: "Run commands",
        inputSchema,
        execute: () => ({ ok: true }),
      },
    });

    assertEquals(normalized.bash?.inputSchemaJson, undefined);
    assertEquals(toolToProviderDefinition(normalized.bash as never).parameters, {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
    });
  });

  it("falls back for schema-like objects that are not JSON Schema", () => {
    const normalized = normalizeBashToolSet({
      bash: {
        description: "Run commands",
        inputSchema: { metadata: { name: "bash" } },
        execute: () => ({ ok: true }),
      },
    });

    assertEquals(normalized.bash?.inputSchemaJson, {
      type: "object",
      properties: {},
      additionalProperties: true,
    });
  });

  it("handles invalid definitions gracefully", () => {
    assertEquals(normalizeBashToolSet({ bad: "not-an-object" }), { bad: { id: "bad" } });
    assertEquals(normalizeBashToolSet({ bad: null }), { bad: { id: "bad" } });
    assertEquals(normalizeBashToolSet({ tool: { inputSchemaJson: "bad" } }), {
      tool: { id: "tool" },
    });
  });
});
