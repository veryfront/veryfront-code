import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ToolDefinition } from "#veryfront/tool";
import {
  createMoonshotSchemaExpansionBudget,
  getProviderToolProfile,
  normalizeProviderToolInputSchema,
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

function countNodes(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((total, item) => total + countNodes(item), 1);
  }
  if (!value || typeof value !== "object") return 1;
  return Object.values(value).reduce<number>((total, item) => total + countNodes(item), 1);
}

/**
 * Build a schema whose every level fans out into two references to the next level, so
 * naive `$ref` inlining grows as 2^levelCount.
 */
function buildFanOutRefSchema(levelCount: number, description?: string) {
  const terminal: Record<string, unknown> = { type: "string" };
  if (description !== undefined) terminal.description = description;
  const properties: Record<string, unknown> = { [`level${levelCount}`]: terminal };

  for (let level = levelCount - 1; level >= 0; level -= 1) {
    const node: Record<string, unknown> = {
      type: "object",
      properties: {
        left: { $ref: `#/properties/level${level + 1}` },
        right: { $ref: `#/properties/level${level + 1}` },
      },
    };
    if (description !== undefined) node.description = description;
    properties[`level${level}`] = node;
  }

  return { type: "object", properties };
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
  it("leaves non-sanitizing provider schemas untouched", () => {
    const schema = {
      type: "object",
      properties: { "bad key": { type: "string" }, ok: { type: "string" } },
      required: ["bad key", "ok"],
    } as never;

    assertStrictEquals(
      sanitizeProviderToolSchema(schema, { model: "openai/gpt-5.2" }),
      schema,
      "OpenAI tool schemas must be returned by identity, never property-key sanitized",
    );
    assertStrictEquals(
      sanitizeProviderToolSchema(schema, { model: "some-local-model" }),
      schema,
      "unknown-provider tool schemas must be returned by identity",
    );
    assertStrictEquals(
      sanitizeProviderToolSchema(schema, {}),
      schema,
      "tool schemas with no model must be returned by identity",
    );

    const sanitized = sanitizeProviderToolSchema(schema, { model: "anthropic/claude-opus-4-6" });
    assertEquals(
      Object.keys(sanitized.properties ?? {}),
      ["ok"],
      "sanitizing providers must drop property keys that fail the provider pattern",
    );
    assertEquals(
      sanitized.required,
      ["ok"],
      "sanitizing providers must drop the required entry of a dropped property",
    );
  });

  it("returns independent permissive fallback schemas", () => {
    for (
      const createFallback of [
        () => normalizeProviderToolInputSchema(null as never),
        () =>
          sanitizeProviderToolSchema(null as never, {
            model: "anthropic/claude-opus-4-6",
          }),
      ]
    ) {
      const first = createFallback();
      (first.properties as Record<string, unknown>).injected = { type: "string" };

      assertEquals(createFallback(), {
        type: "object",
        properties: {},
        additionalProperties: true,
      });
    }
  });

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

  it("keeps Google array schemas valid when upstream tools omit item schemas", () => {
    const sanitized = sanitizeProviderToolSchema(
      {
        type: "object",
        properties: {
          labelIds: {
            type: "array",
            description: "Label IDs to apply.",
          },
        },
      } as never,
      { model: "google-ai-studio/gemini-2.5-pro" },
    );

    assertEquals(sanitized.properties?.labelIds?.type, "array");
    assertEquals(sanitized.properties?.labelIds?.items, {});
  });

  it("normalizes Moonshot tool schemas to use $defs references", () => {
    const sanitized = sanitizeProviderToolSchema(
      {
        type: "object",
        properties: {
          acceptance_criteria: {
            $ref: "#/definitions/acceptanceCriteria",
          },
        },
        definitions: {
          acceptanceCriteria: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
              },
              required: ["label"],
            },
          },
        },
      } as never,
      { model: "veryfront-cloud/moonshotai/kimi-k2.6" },
    );
    const sanitizedRecord = sanitized as Record<string, Record<string, unknown> | undefined>;
    const properties = sanitizedRecord.properties as Record<string, Record<string, unknown>>;
    const defs = sanitizedRecord.$defs as Record<string, Record<string, unknown>>;

    assertEquals(properties.acceptance_criteria?.$ref, "#/$defs/acceptanceCriteria");
    assertEquals(sanitizedRecord.definitions, undefined);
    assertEquals(defs.acceptanceCriteria?.type, "array");
  });

  it("normalizes short Kimi aliases as Moonshot tool schemas", () => {
    const profile = getProviderToolProfile("kimi-k2.6");
    const sanitized = sanitizeProviderToolSchema(
      {
        type: "object",
        properties: {
          acceptance_criteria: {
            $ref: "#/definitions/acceptanceCriteria",
          },
        },
        definitions: {
          acceptanceCriteria: {
            type: "array",
            items: { type: "string" },
          },
        },
      } as never,
      { model: "kimi-k2.6" },
    );
    const sanitizedRecord = sanitized as Record<string, Record<string, unknown> | undefined>;
    const properties = sanitizedRecord.properties as Record<string, Record<string, unknown>>;
    const defs = sanitizedRecord.$defs as Record<string, Record<string, unknown>>;

    assertEquals(profile, { provider: "moonshot", sanitizeSchema: true });
    assertEquals(properties.acceptance_criteria?.$ref, "#/$defs/acceptanceCriteria");
    assertEquals(sanitizedRecord.definitions, undefined);
    assertEquals(defs.acceptanceCriteria?.type, "array");
  });

  it("inlines Moonshot tool refs that point outside $defs", () => {
    const sanitized = sanitizeProviderToolSchema(
      {
        type: "object",
        properties: {
          expectations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                description: { type: "string" },
              },
              required: ["id", "description"],
            },
          },
          acceptance_criteria: {
            $ref: "#/properties/expectations",
          },
        },
      } as never,
      { model: "veryfront-cloud/moonshotai/kimi-k2.6" },
    );
    const sanitizedRecord = sanitized as Record<string, Record<string, unknown> | undefined>;
    const properties = sanitizedRecord.properties as Record<string, Record<string, unknown>>;

    assertEquals(properties.acceptance_criteria?.$ref, undefined);
    assertEquals(properties.acceptance_criteria?.type, "array");
    assertEquals(JSON.stringify(sanitized).includes("#/properties/"), false);
  });

  it("bounds Moonshot ref inlining for fan-out ref chains", () => {
    // 15 levels, not a deeper hostile case: without the budget this already expands to
    // roughly 327,000 nodes, which trips the assertion below while still completing
    // promptly. A 40-level case would instead hang or exhaust the worker on regression,
    // reporting a timeout rather than a useful failure.
    const sanitized = sanitizeProviderToolSchema(
      buildFanOutRefSchema(15) as never,
      { model: "veryfront-cloud/moonshotai/kimi-k2.6" },
    );

    // Without an expansion budget every sibling ref re-expands, so this compact schema
    // would grow to roughly 2^15 leaves before the model call is even made.
    assertEquals(countNodes(sanitized) < 200_000, true);
    // The budget stops inlining rather than expanding, so deep refs stay as references.
    assertEquals(JSON.stringify(sanitized).includes("#/properties/level"), true);
  });

  it("bounds Moonshot ref inlining by serialized bytes, not just node count", () => {
    // Every ref target carries a large description. The node budget alone counts each
    // description as a single node, so ~20,000 admitted nodes could still serialize to
    // tens of megabytes; the byte budget is what actually bounds the request payload.
    const sanitized = sanitizeProviderToolSchema(
      buildFanOutRefSchema(15, "x".repeat(2_000)) as never,
      { model: "veryfront-cloud/moonshotai/kimi-k2.6" },
    );

    assertEquals(JSON.stringify(sanitized).length < 1_000_000, true);
    assertEquals(JSON.stringify(sanitized).includes("#/properties/level"), true);
  });

  it("bounds Moonshot ref inlining across a whole tool set", () => {
    // A per-schema budget bounds one tool; a source returning many admissible schemas
    // would otherwise multiply the worst case by the tool count.
    const budget = createMoonshotSchemaExpansionBudget();
    let totalNodes = 0;
    for (let index = 0; index < 50; index += 1) {
      totalNodes += countNodes(sanitizeProviderToolSchema(
        buildFanOutRefSchema(15) as never,
        {
          model: "veryfront-cloud/moonshotai/kimi-k2.6",
          moonshotExpansionBudget: budget,
        },
      ));
    }

    // Per-schema budgets alone would allow ~50x the single-schema ceiling here.
    assertEquals(totalNodes < 400_000, true);
  });

  it("still inlines refs for every tool in an ordinary tool set", () => {
    // The tool-set budget is charged only for inlined material, so a long list of
    // modest schemas must not starve later tools of inlining.
    const budget = createMoonshotSchemaExpansionBudget();
    for (let index = 0; index < 500; index += 1) {
      const sanitized = sanitizeProviderToolSchema(
        {
          type: "object",
          properties: {
            target: { type: "string", description: "target" },
            alias: { $ref: "#/properties/target" },
          },
        } as never,
        {
          model: "veryfront-cloud/moonshotai/kimi-k2.6",
          moonshotExpansionBudget: budget,
        },
      );

      assertEquals(JSON.stringify(sanitized).includes("$ref"), false);
    }
  });

  it("preserves Moonshot tool properties named definitions", () => {
    const sanitized = sanitizeProviderToolSchema(
      {
        type: "object",
        properties: {
          definitions: {
            type: "string",
            description: "User-provided glossary text.",
          },
          nested: {
            type: "object",
            properties: {
              definitions: {
                type: "number",
              },
            },
            required: ["definitions"],
          },
        },
        required: ["definitions", "nested"],
      } as never,
      { model: "veryfront-cloud/moonshotai/kimi-k2.6" },
    );
    const sanitizedRecord = sanitized as Record<string, unknown>;
    const properties = sanitizedRecord.properties as Record<string, Record<string, unknown>>;
    const nested = properties.nested as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    assertEquals(properties.definitions?.type, "string");
    assertEquals(nested.properties?.definitions, { type: "number" });
    assertEquals(nested.required, ["definitions"]);
    assertEquals(sanitizedRecord.required, ["definitions", "nested"]);
    assertEquals(sanitizedRecord.$defs, undefined);
  });

  it("removes Anthropic-incompatible property keys and matching required entries", () => {
    const sanitized = sanitizeProviderToolSchema(
      {
        type: "object",
        properties: {
          ok_name: { type: "string" },
          "bad key": { type: "string" },
          "nested-object": {
            type: "object",
            properties: {
              "also/bad": { type: "string" },
              fine: { type: "number" },
            },
            required: ["also/bad", "fine"],
          },
          aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: {
            type: "boolean",
          },
        },
        required: [
          "ok_name",
          "bad key",
          "nested-object",
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ],
      } as never,
      { model: "veryfront-cloud/anthropic/claude-sonnet-4-6" },
    );

    assertEquals(Object.keys(sanitized.properties ?? {}), ["ok_name", "nested-object"]);
    assertEquals(sanitized.required, ["ok_name", "nested-object"]);
    assertEquals(
      Object.keys(
        (sanitized.properties?.["nested-object"] as { properties?: Record<string, unknown> })
          .properties ?? {},
      ),
      ["fine"],
    );
    assertEquals(
      (sanitized.properties?.["nested-object"] as { required?: unknown[] }).required,
      ["fine"],
    );
  });

  it("removes every unsupported Anthropic root composition keyword", () => {
    for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
      const sanitized = sanitizeProviderToolSchema(
        {
          [keyword]: [
            {
              type: "object",
              properties: { shared: { type: "string" } },
              required: ["shared"],
            },
            {
              type: "object",
              properties: { extra: { type: "number" } },
              required: ["extra"],
            },
          ],
        } as never,
        { model: "anthropic/claude-opus-4-6" },
      );

      assertEquals(sanitized.type, "object");
      assertEquals(Object.hasOwn(sanitized, "allOf"), false);
      assertEquals(Object.hasOwn(sanitized, "anyOf"), false);
      assertEquals(Object.hasOwn(sanitized, "oneOf"), false);
      assertEquals(Object.keys(sanitized.properties ?? {}), ["shared", "extra"]);
      assertEquals(sanitized.required, keyword === "allOf" ? ["shared", "extra"] : undefined);
    }
  });

  it("preserves local reference constraints when flattening Anthropic compositions", () => {
    const sanitized = sanitizeProviderToolSchema(
      {
        anyOf: [
          {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
          { $ref: "#/$defs/defaultQuery" },
        ],
        $defs: {
          defaultQuery: {
            type: "object",
            properties: { fallback: { type: "boolean" } },
            required: ["fallback"],
          },
        },
      } as never,
      { model: "anthropic/claude-opus-4-6" },
    );

    assertEquals(Object.keys(sanitized.properties ?? {}), ["query", "fallback"]);
    assertEquals(sanitized.required, undefined);
    assertEquals(sanitized.$defs, {
      defaultQuery: {
        type: "object",
        properties: { fallback: { type: "boolean" } },
        required: ["fallback"],
      },
    });
  });
});
