import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createNativeTypeGenerator } from "#veryfront/events/ag-ui/generator.ts";

describe("native type generator", () => {
  it("emits discriminant, dataschema, payload and record maps from matching variants", () => {
    const schema = {
      $defs: {
        ValueRecorded: {
          type: "object",
          additionalProperties: false,
          required: ["protocol"],
          properties: {
            protocol: {
              type: "object",
              additionalProperties: false,
              required: ["agui"],
              properties: {
                agui: {
                  type: "object",
                  additionalProperties: false,
                  required: ["eventType"],
                  properties: { eventType: { const: "RAW" } },
                },
              },
            },
          },
        },
      },
      oneOf: [{
        type: "object",
        required: ["type", "dataschema", "data"],
        properties: {
          type: { const: "value.recorded" },
          dataschema: { const: "urn:example#/$defs/ValueRecorded" },
          data: { $ref: "#/$defs/ValueRecorded" },
          id: { type: "string" },
        },
      }],
    };
    const generator = createNativeTypeGenerator({
      recordSchema: schema,
      pathAliases: new Map(),
      label: "test",
    });
    const source = generator.recordSource({
      name: "Example",
      profile: "example",
      schemaName: "EXAMPLE_SCHEMA",
    });
    for (
      const expected of [
        'export type AgUiNativeExampleType =\n  | "value.recorded"',
        'readonly "value.recorded": "urn:example#/$defs/ValueRecorded";',
        'readonly "value.recorded": AgUiNativeValueRecordedPayload;',
        'readonly RAW: AgUiEventOf<"RAW">;',
        'readonly "data": AgUiNativeExamplePayload<TType>;',
        'readonly "id"?: string;',
        "export interface AgUiExampleAttribution",
      ]
    ) assertEquals(source.includes(expected), true, expected);
    const custom = generator.recordSource({
      name: "Example",
      profile: "example",
      schemaName: "EXAMPLE_SCHEMA",
      attributionLines: ["export type Attribution = never;", ""],
    });
    assertEquals(custom.includes("export type Attribution = never;"), true);
    assertEquals(custom.includes("export interface AgUiExampleAttribution"), false);
  });
  it("keeps aliases at reference targets and preserves readonly union array grouping", () => {
    const generator = createNativeTypeGenerator({
      recordSchema: { $defs: { Payload: { type: "object", additionalProperties: true } } },
      pathAliases: new Map([["Payload", "SavedPayload"]]),
      label: "test",
    });
    assertEquals(
      generator.tsForSchema({ $ref: "urn:example#/$defs/Payload" }, "record.data"),
      "SavedPayload",
    );
    assertEquals(
      generator.tsForSchema(
        { type: "array", minItems: 1, items: { type: ["string", "null"] } },
        "items",
      ),
      "readonly [(string | null), ...(string | null)[]]",
    );
    assertEquals(
      generator.tsForSchema({ type: "array", items: { enum: ["a", "b"] } }, "items"),
      'readonly (("a" | "b"))[]',
    );
  });

  it("renders required and optional object fields in schema insertion order", () => {
    const generator = createNativeTypeGenerator({
      recordSchema: {},
      pathAliases: new Map(),
      label: "test",
    });
    assertEquals(
      generator.tsForSchema({
        type: "object",
        additionalProperties: false,
        required: ["flag", 1],
        properties: { flag: { type: "boolean" }, count: { type: "integer" }, empty: {} },
      }, "payload"),
      '{\n  readonly "flag": boolean;\n  readonly "count"?: number;\n  readonly "empty"?: unknown;\n}',
    );
    assertEquals(generator.tsForSchema({ type: "object" }, "empty"), "{}");
    assertEquals(
      generator.tsForSchema({ oneOf: [{ const: "a" }, { type: "number" }] }, "choice"),
      '"a" | number',
    );
  });

  it("rejects unsupported schema shapes with profile and path diagnostics", () => {
    const generator = createNativeTypeGenerator({
      recordSchema: { $defs: {} },
      pathAliases: new Map(),
      label: "native test",
    });
    for (
      const [schema, path, detail] of [
        [null, "payload", "schema must be an object"],
        [{ $ref: "https://example.test/schema" }, "$ref", "only local $defs refs are supported"],
        [{ $ref: "#/$defs/Missing" }, "$ref", "missing definition Missing"],
        [{ type: "array" }, "payload", "array schema requires items"],
        [
          { type: "array", items: {}, minItems: 2 },
          "array.minItems",
          "only minItems: 1 is supported",
        ],
        [
          { type: "object", additionalProperties: true },
          "payload",
          "open object schemas require an explicit path alias",
        ],
        [{ not: { type: "null" } }, "payload", "unhandled schema keys not"],
      ] as const
    ) {
      assertThrows(
        () => generator.tsForSchema(schema, "payload"),
        Error,
        `Unsupported AG-UI native test schema construct at ${path}: ${detail}`,
      );
    }
    assertThrows(
      () =>
        createNativeTypeGenerator({ recordSchema: {}, pathAliases: new Map(), label: "test" })
          .resolveRef("#/$defs/X"),
      Error,
      "schema definitions must be an object",
    );
  });
});
