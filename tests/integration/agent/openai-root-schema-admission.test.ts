import { Ajv2020 } from "npm:ajv@8.18.0/dist/2020.js";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sanitizeProviderToolSchema } from "#veryfront/agent/runtime/provider-tool-compat.ts";

// Validate instances against both schemas: preserving a reference's spelling
// does not prove it still admits the same arguments after its target changes.
describe("OpenAI root schema admission", () => {
  const alternatives = [
    { properties: { x: {} }, required: ["x"] },
    { properties: { y: {} }, required: ["y"] },
  ];
  const cases = [
    { name: "negation", nested: { not: { $ref: "#" } }, value: {} },
    { name: "exclusive alternatives", nested: { oneOf: [{ $ref: "#" }, {}] }, value: {} },
    {
      name: "conditional",
      nested: { if: { $ref: "#" }, then: { type: "string" }, else: {} },
      value: {},
    },
    {
      name: "upper-bounded contains",
      nested: { type: "array", contains: { $ref: "#" }, minContains: 0, maxContains: 0 },
      value: [{}],
    },
    {
      name: "negation through a definition",
      nested: { not: { $ref: "#/$defs/recursive" } },
      $defs: { recursive: { $ref: "#" } },
      value: {},
    },
    {
      name: "unevaluated properties after a complex branch falls back",
      nested: { allOf: [{ $ref: "#" }], unevaluatedProperties: false },
      anyOf: [{ allOf: [alternatives[0]] }],
      value: { x: true },
    },
    {
      name: "a negative branch using a shared root definition",
      nested: {},
      $defs: { recursive: { $ref: "#" } },
      anyOf: ["x", "y"].map((key) => ({
        properties: { [key]: {}, nested: { not: { $ref: "#/$defs/recursive" } } },
        required: [key],
      })),
      value: {},
    },
    { name: "positive recursion", nested: { $ref: "#" }, value: { x: true } },
  ];
  for (const example of cases) {
    it(`retains valid arguments with ${example.name}`, () => {
      const authored = {
        type: "object",
        properties: { nested: example.nested },
        anyOf: example.anyOf ?? alternatives,
        ...(example.$defs ? { $defs: example.$defs } : {}),
      };
      const value = { x: true, nested: example.value };
      const compiler = new Ajv2020({ strict: false });
      assertEquals(compiler.compile(authored)(value), true, "authored schema admits this input");
      const wire = sanitizeProviderToolSchema(authored as never, { model: "openai/gpt-5.4" });
      const validateWire = compiler.compile(wire);
      assertEquals(validateWire(value), true, JSON.stringify(validateWire.errors));
    });
  }
});
