import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { defineSchema } from "#veryfront/schemas/index.ts";
import {
  createSandboxShellTools,
  normalizeBashToolSet,
  renameSandboxFileTools,
} from "./shell-tools.ts";
import { createToolsFromHostDefinitions } from "#veryfront/tool/host-tools.ts";
import { toolToProviderDefinition } from "#veryfront/tool/registry.ts";
import type { JsonSchema } from "#veryfront/tool/schema/json-schema.ts";

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
      "Read a file from the sandbox",
    );
    assertStringIncludes(
      String(tools.sandbox_read_file.description),
      "does NOT read project files stored in Veryfront",
    );
    assertStringIncludes(
      String(tools.sandbox_read_file.description),
      "get_file/get_files",
    );
    assertExists(tools.sandbox_write_file);
    assertStringIncludes(
      String(tools.sandbox_write_file.description),
      "Write a file inside the sandbox",
    );
    assertStringIncludes(
      String(tools.sandbox_write_file.description),
      "does NOT update project files stored in Veryfront",
    );
    assertStringIncludes(
      String(tools.sandbox_write_file.description),
      "create_file/update_file",
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

  it("keeps typed properties alongside untyped sub-schemas", () => {
    const normalized = normalizeBashToolSet({
      bash: {
        description: "Run commands",
        inputSchemaJson: {
          type: "object",
          properties: {
            command: { type: "string" },
            options: { description: "extra" },
          },
          required: ["command"],
        },
      },
    });

    assertEquals(
      normalized.bash?.inputSchemaJson,
      {
        type: "object",
        properties: {
          command: { type: "string" },
          options: { description: "extra" },
        },
        required: ["command"],
      },
      "a typed property survives alongside an untyped but non-empty sub-schema",
    );
  });

  it("round-trips nested JSON Schema keywords", () => {
    const inputSchemaJson: JsonSchema = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" }, minItems: 1 },
        mode: { type: "string", enum: ["fast", "slow"], default: "fast" },
        target: { anyOf: [{ type: "string" }, { type: "number" }] },
        pair: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] },
        version: { const: 2 },
      },
      required: ["tags"],
    };

    const normalized = normalizeBashToolSet({
      bash: { description: "Run commands", inputSchemaJson },
    });

    assertEquals(
      normalized.bash?.inputSchemaJson,
      inputSchemaJson,
      "nested JSON Schema keywords round-trip through normalizeJsonSchema",
    );
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

  it("materializes parser schemas with methods named like JSON Schema keywords", () => {
    class ExternalParserSchema {
      default = () => this;

      parse(input: unknown) {
        return input;
      }
    }

    const createExternalTool = () => ({
      description: "Use a sandbox tool",
      inputSchema: new ExternalParserSchema(),
      execute: () => ({ ok: true }),
    });
    const normalized = renameSandboxFileTools(
      normalizeBashToolSet({
        bash: createExternalTool(),
        readFile: createExternalTool(),
        writeFile: createExternalTool(),
      }),
    );

    assertEquals(normalized.bash?.inputSchemaJson, {
      type: "object",
      properties: {},
      additionalProperties: true,
    });
    assertEquals(Object.keys(createToolsFromHostDefinitions(normalized)), [
      "bash",
      "sandbox_read_file",
      "sandbox_write_file",
    ]);
  });

  it("handles invalid definitions gracefully", () => {
    assertEquals(normalizeBashToolSet({ bad: "not-an-object" }), { bad: { id: "bad" } });
    assertEquals(normalizeBashToolSet({ bad: null }), { bad: { id: "bad" } });
    assertEquals(normalizeBashToolSet({ tool: { inputSchemaJson: "bad" } }), {
      tool: { id: "tool" },
    });
  });
});
