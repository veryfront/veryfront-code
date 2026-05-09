import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ToolDefinition } from "#veryfront/tool";
import {
  sanitizeProviderToolSchema,
  selectProviderCompatibleToolNames,
  selectProviderCompatibleTools,
} from "./provider-tool-compat.ts";

function dummyTool(name: string): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: "object", properties: {} },
  };
}

function containsKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, key)) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsKey(item, key));
  }
  return Object.values(value).some((item) => containsKey(item, key));
}

describe("provider-tool-compat", () => {
  it("caps OpenAI-compatible tool names while preserving required tools first", () => {
    const requiredToolNames = ["form_input", "invoke_agent", "load_skill", "sleep"];
    const remoteToolNames = Array.from({ length: 150 }, (_, index) => `remote_${index}`);

    const selected = selectProviderCompatibleToolNames(
      [...requiredToolNames, ...remoteToolNames],
      {
        model: "veryfront-cloud/openai/gpt-5.2",
        requiredToolNames,
      },
    );

    assertEquals(selected.length, 128);
    assertEquals(selected.slice(0, requiredToolNames.length), requiredToolNames);
    assertEquals(selected.includes("remote_0"), true);
    assertEquals(selected.includes("remote_123"), true);
    assertEquals(selected.includes("remote_124"), false);
  });

  it("caps OpenAI-compatible tool definitions deterministically", () => {
    const tools = Array.from({ length: 150 }, (_, index) => dummyTool(`tool_${index}`));

    const selected = selectProviderCompatibleTools(tools, {
      model: "openai/gpt-5.2",
    });

    assertEquals(selected.length, 128);
    assertEquals(selected[0]?.name, "tool_0");
    assertEquals(selected.at(-1)?.name, "tool_127");
  });

  it("sanitizes Google tool schemas to avoid unsupported JSON Schema keywords", () => {
    const sanitized = sanitizeProviderToolSchema(
      {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "tool-schema",
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            const: "file",
            default: "file",
          },
          nested: {
            anyOf: [
              { type: "string", const: "a" },
              { type: "string", const: "b" },
            ],
          },
          refValue: {
            $ref: "#/$defs/refValue",
          },
        },
      } as never,
      { model: "veryfront-cloud/google-ai-studio/gemini-2.5-flash" },
    );

    assertEquals(containsKey(sanitized, "const"), false);
    assertEquals(containsKey(sanitized, "default"), false);
    assertEquals(containsKey(sanitized, "additionalProperties"), false);
    assertEquals(containsKey(sanitized, "$schema"), false);
    assertEquals(containsKey(sanitized, "$id"), false);
    assertEquals(containsKey(sanitized, "$ref"), false);
    assertEquals(containsKey(sanitized, "anyOf"), false);
    assertEquals(sanitized.properties?.kind?.enum, ["file"]);
    assertEquals(sanitized.properties?.nested?.enum, ["a", "b"]);
  });

  it("does not assign a schema type when collapsed anyOf literals are mixed types", () => {
    const sanitized = sanitizeProviderToolSchema(
      {
        anyOf: [
          { const: "file" },
          { const: 1 },
        ],
      } as never,
      { model: "google-ai-studio/gemini-2.5-pro" },
    );

    assertEquals(sanitized.enum, ["file", 1]);
    assertEquals(sanitized.type, undefined);
  });

  it("normalizes Google schemas that use JSON Schema type arrays and numeric exclusive bounds", () => {
    const sanitized = sanitizeProviderToolSchema(
      {
        type: "object",
        properties: {
          maybeText: {
            type: ["string", "null"],
          },
          flexible: {
            type: ["string", "number"],
          },
          count: {
            type: "number",
            exclusiveMinimum: 0,
            exclusiveMaximum: 10,
          },
        },
      } as never,
      { model: "google-ai-studio/gemini-2.5-pro" },
    );

    assertEquals(sanitized.properties?.maybeText?.type, "string");
    assertEquals(sanitized.properties?.flexible?.type, undefined);
    assertEquals(containsKey(sanitized, "exclusiveMinimum"), false);
    assertEquals(containsKey(sanitized, "exclusiveMaximum"), false);
  });

});
