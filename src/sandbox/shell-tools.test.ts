import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert";
import { VeryfrontError } from "#veryfront/errors";
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

  it("rejects unconverted provider schemas instead of weakening them", () => {
    assertThrows(
      () =>
        normalizeBashToolSet({
          bash: {
            description: "Run commands",
            inputSchema: { parse: (input: unknown) => input },
            execute: () => ({ ok: true }),
          },
        }),
      VeryfrontError,
      "provider must supply inputSchemaJson",
    );
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

  it("rejects schema-like objects that are not JSON Schema", () => {
    assertThrows(
      () =>
        normalizeBashToolSet({
          bash: {
            description: "Run commands",
            inputSchema: { metadata: { name: "bash" } },
            execute: () => ({ ok: true }),
          },
        }),
      VeryfrontError,
      "provider must supply inputSchemaJson",
    );
  });

  it("rejects malformed definitions and invalid explicit schemas", () => {
    assertThrows(
      () => normalizeBashToolSet({ bad: "not-an-object" }),
      VeryfrontError,
      "definition must be an object",
    );
    assertThrows(
      () => normalizeBashToolSet({ bad: null }),
      VeryfrontError,
      "definition must be an object",
    );
    assertThrows(
      () => normalizeBashToolSet({ tool: { inputSchemaJson: "bad" } }),
      VeryfrontError,
      "inputSchemaJson is not a JSON Schema",
    );
  });

  it("preserves supported JSON Schema constraints without sharing mutable data", () => {
    const inputSchemaJson = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        command: {
          type: "string",
          pattern: "^[a-z]+$",
          minLength: 1,
        },
      },
      required: ["command"],
      allOf: [{ additionalProperties: false }],
    };
    const normalized = normalizeBashToolSet({
      bash: { inputSchemaJson },
    });

    assertEquals(normalized.bash?.inputSchemaJson, inputSchemaJson);
    inputSchemaJson.required.push("later");
    assertEquals(normalized.bash?.inputSchemaJson?.required, ["command"]);
  });

  it("does not invoke tool-map or schema accessors", () => {
    let toolAccessorCalled = false;
    const tools = {};
    Object.defineProperty(tools, "bash", {
      enumerable: true,
      get() {
        toolAccessorCalled = true;
        return {};
      },
    });
    assertThrows(
      () => normalizeBashToolSet(tools),
      VeryfrontError,
      "must be a data property",
    );
    assertEquals(toolAccessorCalled, false);

    let schemaAccessorCalled = false;
    const schema = { type: "object" };
    Object.defineProperty(schema, "properties", {
      enumerable: true,
      get() {
        schemaAccessorCalled = true;
        return {};
      },
    });
    assertThrows(
      () => normalizeBashToolSet({ bash: { inputSchemaJson: schema } }),
      VeryfrontError,
      "must be a data property",
    );
    assertEquals(schemaAccessorCalled, false);
  });
});
