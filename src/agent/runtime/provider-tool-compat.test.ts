import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForTests,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import type { ToolDefinition } from "#veryfront/tool";
import {
  createMoonshotSchemaExpansionBudget,
  createRootSchemaExpansionBudget,
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
  it("keeps required names declared before properties", () => {
    const schema = {
      type: "object",
      required: ["search", "bad key"],
      properties: {
        search: {
          type: "object",
          required: ["query", "bad key"],
          properties: { query: { type: "string" }, "bad key": { type: "string" } },
        },
        "bad key": { type: "string" },
      },
    } as never;
    const sanitized = sanitizeProviderToolSchema(schema, { model: "anthropic/claude-haiku-4-5" });
    assertEquals(sanitized.required, ["search"]);
    assertEquals(Object.keys(sanitized.properties as Record<string, unknown>), ["search"]);
    assertEquals(
      (sanitized.properties as Record<string, { required?: string[] }>).search?.required,
      ["query"],
    );
  });

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

  it("bounds fan-out references while folding Anthropic roots", () => {
    const defs: Record<string, unknown> = {
      level14: { type: "object", properties: { value: { type: "string" } } },
    };
    for (let index = 13; index >= 0; index--) {
      defs[`level${index}`] = {
        allOf: [{ $ref: `#/$defs/level${index + 1}` }, { $ref: `#/$defs/level${index + 1}` }],
      };
    }
    assertThrows(
      () =>
        sanitizeProviderToolSchema(
          { type: "object", $defs: defs, allOf: [{ $ref: "#/$defs/level0" }] } as never,
          { model: "anthropic/claude-opus-4-6" },
        ),
      TypeError,
      "root normalization budget",
    );
  });
  it("bounds reference depth while folding Anthropic roots", () => {
    const defs: Record<string, unknown> = {
      level80: { type: "object", properties: { value: { type: "string" } } },
    };
    for (let index = 79; index >= 0; index--) {
      defs[`level${index}`] = { $ref: `#/$defs/level${index + 1}` };
    }
    assertThrows(
      () =>
        sanitizeProviderToolSchema(
          { type: "object", $defs: defs, allOf: [{ $ref: "#/$defs/level0" }] } as never,
          { model: "anthropic/claude-opus-4-6" },
        ),
      TypeError,
      "root normalization budget",
    );
  });
  it("bounds encoded bytes introduced by references while folding Anthropic roots", () => {
    assertThrows(
      () =>
        sanitizeProviderToolSchema(
          {
            type: "object",
            $defs: { large: { type: "object", description: "\u0000".repeat(90_000) } },
            allOf: [{ $ref: "#/$defs/large" }],
          } as never,
          { model: "anthropic/claude-opus-4-6" },
        ),
      TypeError,
      "root normalization budget",
    );
  });
  it("accepts large unchanged input while folding OpenAI roots", () => {
    const description = "\u0000".repeat(90_000);
    const result = sanitizeProviderToolSchema(
      { type: "object", description, allOf: [{ type: "object" }] } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(result.description, description);
    assertEquals(Object.hasOwn(result, "allOf"), false);
  });
  it("shares the root expansion allowance across a tool collection", () => {
    const budget = createRootSchemaExpansionBudget();
    budget.remainingNodes = 100;
    const schema = {
      type: "object",
      $defs: { input: { properties: { value: { type: "string" } } } },
      allOf: [{ $ref: "#/$defs/input" }],
    } as never;
    const options = { model: "anthropic/claude-opus-4-6", rootExpansionBudget: budget };
    assertEquals(sanitizeProviderToolSchema(schema, options).type, "object");
    assertThrows(
      () => {
        for (let index = 0; index < 100; index++) sanitizeProviderToolSchema(schema, options);
      },
      TypeError,
      "root normalization budget",
    );
  });
  it("keeps a root reference as authored while folding", () => {
    const schema = {
      type: "object",
      $ref: "#/$defs/input",
      allOf: [],
      $defs: { input: { type: "object", properties: { mode: { type: "string" } } } },
    } as never;
    const result = sanitizeProviderToolSchema(schema, { model: "openai/gpt-5.4" });
    assertEquals(result.$ref, "#/$defs/input");
    assertEquals(Object.hasOwn(result, "allOf"), false);
  });
  it("accepts large unchanged Anthropic schemas without spending expansion allowance", () => {
    for (const length of [260_000, 1024 * 1024]) {
      const budget = createRootSchemaExpansionBudget();
      const schema = {
        type: "object",
        description: "d".repeat(length),
        properties: { value: { type: "string" } },
      };
      const normalized = sanitizeProviderToolSchema(schema as never, {
        model: "anthropic/claude-opus-4-6",
        rootExpansionBudget: budget,
      });
      assertEquals(normalized.description, schema.description);
      assertEquals(budget.remainingNodes, 200_000);
      assertEquals(budget.remainingBytes, 8 * 1024 * 1024);
    }
  });
  it("charges a large root composition branch at most once", () => {
    const budget = createRootSchemaExpansionBudget();
    const description = "d".repeat(180 * 1024);
    const normalized = sanitizeProviderToolSchema(
      {
        type: "object",
        anyOf: [{ properties: { value: { type: "string", description } } }, {
          properties: { value: { type: "number" }, other: { type: "number" } },
        }],
      } as never,
      { model: "anthropic/claude-opus-4-6", rootExpansionBudget: budget },
    );
    const value = normalized.properties?.value as { anyOf: { description?: string }[] };
    assertEquals(value.anyOf[0]?.description, description);
    assertEquals(budget.remainingNodes, 200_000);
    assertEquals(budget.remainingBytes, 8 * 1024 * 1024);
  });
  it("keeps the shared expansion allowance for a large reference-free Anthropic catalog", () => {
    const budget = createRootSchemaExpansionBudget();
    const schema = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 252 }, (_, index) => [`field${index}`, { type: "string" }]),
      ),
    } as never;
    for (let index = 0; index < 198; index++) {
      const normalized = sanitizeProviderToolSchema(schema, {
        model: "anthropic/claude-opus-4-6",
        rootExpansionBudget: budget,
      });
      assertEquals(Object.keys(normalized.properties ?? {}).length, 252);
    }
    assertEquals(budget.remainingNodes, 200_000);
    assertEquals(budget.remainingBytes, 8 * 1024 * 1024);
  });
  it("falls back to a permissive root for references into removed compositions", () => {
    const result = sanitizeProviderToolSchema(
      {
        type: "object",
        allOf: [{ properties: { value: { type: "string" } } }],
        properties: { alias: { $ref: "#/allOf/0/properties/value" } },
        required: ["alias"],
      } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(result, {
      type: "object",
      properties: { alias: {}, value: {} },
      required: ["alias"],
    } as never);
  });
  it("folds sibling root compositions beside a root reference", () => {
    const result = sanitizeProviderToolSchema(
      {
        type: "object",
        $ref: "#/$defs/input",
        $defs: {
          input: { allOf: [{ properties: { value: { type: "string" } }, required: ["value"] }] },
        },
        allOf: [{ properties: { extra: { type: "number" } }, required: ["extra"] }],
      } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(result.$ref, "#/$defs/input");
    assertEquals(result.properties, { extra: { type: "number" } });
    assertEquals(result.required, ["extra"]);
  });
  it("keeps bare root references pointing at the widened root", () => {
    const result = sanitizeProviderToolSchema(
      {
        type: "object",
        properties: { child: { $ref: "#" } },
        anyOf: [
          { properties: { kind: { const: "a" } }, required: ["kind"] },
          { properties: { kind: { const: "b" } }, required: ["kind"] },
        ],
      } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(result.properties?.child, { $ref: "#" });
    assertEquals(result.properties?.kind, { anyOf: [{ const: "a" }, { const: "b" }] });
    assertEquals(Object.hasOwn(result, "$defs"), false);
  });
  it("keeps root definitions bound when a folded branch reuses their names", () => {
    for (const model of ["openai/gpt-5.4", "anthropic/claude-opus-4-6"]) {
      const result = sanitizeProviderToolSchema(
        {
          type: "object",
          $defs: { item: { type: "string" } },
          properties: { value: { $ref: "#/$defs/item" } },
          allOf: [{
            $defs: { item: { type: "number" } },
            properties: { flag: { type: "boolean" } },
          }],
        } as never,
        { model },
      );
      assertEquals((result.$defs as Record<string, unknown>).item, { type: "string" }, model);
    }
  });
  it("leaves literal values that look like references unchanged", () => {
    const payload = {
      const: { $ref: "#/anyOf/0" },
      default: { $ref: "#/anyOf/0" },
      examples: [{ $ref: "#/anyOf/0" }],
      enum: [{ $ref: "#/anyOf/0" }],
    };
    const result = sanitizeProviderToolSchema(
      {
        type: "object",
        properties: { payload },
        anyOf: [{ properties: { value: { type: "string" } } }],
      } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(result.properties, { payload, value: { type: "string" } });
  });
  it("never narrows an allOf intersection with a closed branch", () => {
    const result = sanitizeProviderToolSchema(
      {
        type: "object",
        allOf: [
          { properties: { a: { type: "string" } }, additionalProperties: false },
          { properties: { b: { type: "number" } } },
        ],
      } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(result, {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
    } as never);
  });
  it("falls back to a permissive root for branches with pattern properties", () => {
    // Folding never evaluates authored patterns, so a backtracking-prone
    // pattern cannot stall conversion.
    for (
      const branch of [
        { patternProperties: { "^(a+)+$": { type: "number" } }, additionalProperties: false },
        {
          properties: { value: { type: "string" } },
          patternProperties: { "^value$": { maxLength: 1 } },
        },
      ]
    ) {
      const result = sanitizeProviderToolSchema(
        {
          type: "object",
          anyOf: [{ properties: { value: { type: "string" } } }, branch],
        } as never,
        { model: "openai/gpt-5.4" },
      );
      assertEquals(result, { type: "object", properties: { value: {} } } as never);
    }
  });
  it("falls back to a permissive root for branch resources and object constraints", () => {
    const branchResource = sanitizeProviderToolSchema(
      {
        type: "object",
        $defs: { item: { type: "string" } },
        properties: { root: { $ref: "#/$defs/item" } },
        allOf: [{
          $id: "https://example.com/branch",
          $defs: { item: { type: "number" } },
          properties: { value: { $ref: "#/$defs/item" } },
        }],
      } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(branchResource, {
      type: "object",
      $defs: { item: { type: "string" } },
      properties: { root: { $ref: "#/$defs/item" }, value: {} },
    } as never);

    const constrained = sanitizeProviderToolSchema(
      { type: "object", allOf: [{ minProperties: 1 }] } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(constrained, { type: "object" } as never);
  });
  it("falls back for references that are not plain local pointers", () => {
    const anchored = sanitizeProviderToolSchema(
      {
        type: "object",
        properties: { alias: { $ref: "#variant" } },
        anyOf: [{ $anchor: "variant", properties: { value: { type: "string" } } }],
      } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(anchored, { type: "object", properties: { alias: {}, value: {} } } as never);

    const absolute = sanitizeProviderToolSchema(
      {
        $id: "https://example.com/tool",
        type: "object",
        properties: { alias: { $ref: "https://example.com/tool#/anyOf/0" } },
        anyOf: [{ properties: { value: { type: "string" } } }],
      } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(absolute, { type: "object", properties: { alias: {}, value: {} } } as never);

    const nested = sanitizeProviderToolSchema(
      {
        type: "object",
        properties: { nested: { $id: "https://example.com/nested", $ref: "#/$defs/item" } },
        anyOf: [{ properties: { value: { type: "string" } } }],
      } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(nested.properties?.value, {});
  });
  it("keeps a __proto__ property declaration in the fallback root", () => {
    const schema = JSON.parse(
      '{"type":"object","additionalProperties":false,' +
        '"properties":{"__proto__":{"type":"string"}},"anyOf":[{"minProperties":1}]}',
    );
    const result = sanitizeProviderToolSchema(schema, { model: "openai/gpt-5.4" });
    const properties = result.properties as Record<string, unknown>;
    assertEquals(Object.hasOwn(properties, "__proto__"), true);
    assertEquals(Object.getOwnPropertyDescriptor(properties, "__proto__")?.value, {
      type: "string",
    });
  });
  it("snapshots the complete OpenAI schema before removing root keywords", () => {
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 200_000; index++) deep = { not: deep };
    assertThrows(
      () =>
        sanitizeProviderToolSchema(
          { type: "object", anyOf: [{ type: "object" }], not: deep } as never,
          { model: "openai/gpt-5.4" },
        ),
      TypeError,
      "bounded JSON data",
    );
  });
  it("leaves a property unconstrained when an alternative omits it", () => {
    const result = sanitizeProviderToolSchema(
      {
        type: "object",
        anyOf: [{ properties: { value: { type: "string" } } }, {}],
      } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(result.properties?.value, {});

    const closed = sanitizeProviderToolSchema(
      {
        type: "object",
        oneOf: [
          { properties: { value: { type: "string" } } },
          { properties: { other: { type: "number" } }, additionalProperties: false },
        ],
      } as never,
      { model: "openai/gpt-5.4" },
    );
    assertEquals(closed.properties, { value: { type: "string" }, other: {} });
  });
  it("folds many disjoint alternatives in linear space", () => {
    const branches = Array.from({ length: 3_000 }, (_, index) => ({
      properties: { [`field${index}`]: { type: "string" } },
    }));
    const result = sanitizeProviderToolSchema(
      { type: "object", anyOf: branches } as never,
      { model: "openai/gpt-5.4" },
    );
    const properties = Object.values(result.properties ?? {});
    assertEquals(properties.length, 3_000);
    assertEquals(properties.every((schema) => countNodes(schema) === 1), true);
  });
  it("folds root combinators out of OpenAI tool schemas", () => {
    const nested = {
      anyOf: [{ type: "string" }, { type: "object", properties: { text: { type: "string" } } }],
    };
    const createAgentSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        system: { type: "string" },
        system_prompt: { type: "string" },
        model: nested,
      },
      required: ["name"],
      anyOf: [{ required: ["system"] }, { required: ["system_prompt"] }],
    } as never;

    for (
      const model of ["openai/gpt-5.4", "veryfront-cloud/openai/gpt-5.5", "openai/o3"]
    ) {
      const sanitized = sanitizeProviderToolSchema(createAgentSchema, { model });
      assertEquals(sanitized, {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          system: { type: "string" },
          system_prompt: { type: "string" },
          model: nested,
        },
        required: ["name"],
      } as never, model);
      for (const key of ["allOf", "anyOf", "oneOf", "not", "enum"]) {
        assertEquals(Object.hasOwn(sanitized, key), false, `${model} root ${key}`);
      }
    }

    const withRootNotAndEnum = {
      type: "object",
      properties: { mode: { type: "string", enum: ["a", "b"] } },
      not: { required: ["legacy"] },
      enum: [{ mode: "a" }],
      oneOf: [
        { properties: { a: { type: "string" } }, required: ["a"] },
        { properties: { a: { type: "string" } }, required: ["a"] },
      ],
    } as never;
    assertEquals(
      sanitizeProviderToolSchema(withRootNotAndEnum, { model: "openai/gpt-5.4" }),
      {
        type: "object",
        properties: { mode: { type: "string", enum: ["a", "b"] }, a: { type: "string" } },
        required: ["a"],
      } as never,
    );
  });

  it("leaves root combinators alone for providers other than OpenAI", () => {
    const schema = {
      type: "object",
      properties: { system: { type: "string" }, system_prompt: { type: "string" } },
      anyOf: [{ required: ["system"] }, { required: ["system_prompt"] }],
    } as never;

    assertStrictEquals(sanitizeProviderToolSchema(schema, { model: "some-local-model" }), schema);
    assertStrictEquals(sanitizeProviderToolSchema(schema, {}), schema);
    assertStrictEquals(
      sanitizeProviderToolSchema(schema, { model: "mistral/mistral-large" }),
      schema,
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

  for (const wireSurface of [undefined, "openai"] as const) {
    it(`normalizes Moonshot tool schemas to use $defs references (${wireSurface})`, () => {
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
        { model: "veryfront-cloud/moonshotai/kimi-k2.6", wireSurface },
      );
      const sanitizedRecord = sanitized as Record<string, Record<string, unknown> | undefined>;
      const properties = sanitizedRecord.properties as Record<string, Record<string, unknown>>;
      const defs = sanitizedRecord.$defs as Record<string, Record<string, unknown>>;

      assertEquals(properties.acceptance_criteria?.$ref, "#/$defs/acceptanceCriteria");
      assertEquals(sanitizedRecord.definitions, undefined);
      assertEquals(defs.acceptanceCriteria?.type, "array");
    });
  }

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

  for (const wireSurface of [undefined, "openai"] as const) {
    it(`inlines Moonshot tool refs that point outside $defs (${wireSurface})`, () => {
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
        { model: "veryfront-cloud/moonshotai/kimi-k2.6", wireSurface },
      );
      const sanitizedRecord = sanitized as Record<string, Record<string, unknown> | undefined>;
      const properties = sanitizedRecord.properties as Record<string, Record<string, unknown>>;

      assertEquals(properties.acceptance_criteria?.$ref, undefined);
      assertEquals(properties.acceptance_criteria?.type, "array");
      assertEquals(JSON.stringify(sanitized).includes("#/properties/"), false);
    });
  }

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

  it("charges Moonshot expansion for JSON-escaped and multi-byte description bytes", () => {
    // A NUL serializes to the six-byte escape "\\u0000", so character length undercounts
    // the payload sixfold; counting characters would let this expand past the byte cap.
    const escaped = sanitizeProviderToolSchema(
      buildFanOutRefSchema(15, "\u0000".repeat(2_000)) as never,
      { model: "veryfront-cloud/moonshotai/kimi-k2.6" },
    );
    assertEquals(JSON.stringify(escaped).length < 1_000_000, true);

    // Non-ASCII text costs up to four UTF-8 bytes per code point for the same reason.
    const multiByte = sanitizeProviderToolSchema(
      buildFanOutRefSchema(15, "\u{1f600}".repeat(2_000)) as never,
      { model: "veryfront-cloud/moonshotai/kimi-k2.6" },
    );
    assertEquals(JSON.stringify(multiByte).length < 1_000_000, true);
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

describe("getProviderToolProfile for providers only the served catalog lists", () => {
  afterEach(__resetVeryfrontCloudCatalogForTests);

  const served = (surface: string) =>
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "m1",
        modelId: "acme-labs/m1",
        provider: "acme-labs",
        surface,
        operations: [surface === "anthropic" ? "messages" : "chat-completions"],
        aliases: [],
        capabilities: {},
      }],
    });

  it("applies the schema rules of the surface the provider is served on", () => {
    served("google");
    assertEquals(getProviderToolProfile("veryfront-cloud/acme-labs/m1"), {
      provider: "google",
      sanitizeSchema: true,
    });
    served("anthropic");
    assertEquals(getProviderToolProfile("veryfront-cloud/acme-labs/m1"), {
      provider: "anthropic",
      sanitizeSchema: true,
    });
  });

  it("keeps a Google publisher's tool schema on the served OpenAI wire surface", () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "local-model",
        modelId: "google/local-model",
        provider: "google",
        surface: "openai",
        operations: ["chat-completions"],
        aliases: [],
        capabilities: {},
      }],
    });
    assertEquals(getProviderToolProfile("veryfront-cloud/google/local-model", "openai"), {
      provider: "openai",
      maxTools: 128,
      sanitizeSchema: false,
    });
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        target: { oneOf: [{ type: "string" }, { type: "null" }] },
      },
    } as never;
    assertEquals(
      sanitizeProviderToolSchema(schema, {
        model: "veryfront-cloud/google/local-model",
        wireSurface: "openai",
      }),
      schema,
    );
  });

  it("keeps a direct provider ID on its own profile when a wire surface is supplied", () => {
    assertEquals(getProviderToolProfile("google/gemini-2.5-pro", "openai"), {
      provider: "google",
      sanitizeSchema: true,
    });
  });

  it("uses the authenticated wire surface over the served catalog surface", () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "local-model",
        modelId: "acme-labs/local-model",
        provider: "acme-labs",
        surface: "openai",
        operations: ["chat-completions"],
        aliases: [],
        capabilities: {},
      }],
    });
    assertEquals(getProviderToolProfile("veryfront-cloud/acme-labs/local-model", "google"), {
      provider: "google",
      sanitizeSchema: true,
    });
  });

  it("applies the served surface before the kimi- model-name heuristic", () => {
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: "kimi-1",
        modelId: "acme-labs/kimi-1",
        provider: "acme-labs",
        surface: "google",
        operations: ["chat-completions"],
        aliases: [],
        capabilities: {},
      }],
    });
    assertEquals(getProviderToolProfile("veryfront-cloud/acme-labs/kimi-1").provider, "google");
    // The heuristic still applies where no served surface decides.
    assertEquals(getProviderToolProfile("kimi-k2.6").provider, "moonshot");
    assertEquals(getProviderToolProfile("moonshotai/kimi-k2.6").provider, "moonshot");
  });

  it("keeps an unlisted provider on the OpenAI surface, and a direct id, unknown", () => {
    served("openai");
    assertEquals(getProviderToolProfile("veryfront-cloud/acme-labs/m1").provider, "unknown");
    served("anthropic");
    assertEquals(getProviderToolProfile("acme-labs/m1").provider, "unknown");
  });
});
