import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "./define.ts";
import { canonicalJsonSchema, schemaIdentitySha256 } from "./schema-identity.ts";

/**
 * Shared test vector (veryfront/veryfront-issue-inbox#2108). veryfront-api asserts the
 * same canonical string and digest, so both sides compute one identity per schema.
 */
const VECTOR_SCHEMA = {
  type: "object",
  required: ["ticketText"],
  properties: { ticketText: { minLength: 1, type: "string" } },
  additionalProperties: false,
};
const VECTOR_CANONICAL =
  '{"additionalProperties":false,"properties":{"ticketText":{"minLength":1,"type":"string"}},"required":["ticketText"],"type":"object"}';
const VECTOR_SHA256 = "065cc2349686aff1ca583517a1039f86d207793ed9873ba1ec0505ec1f3bbe03";

describe("src/schemas/schema-identity", () => {
  it("canonicalizes a JSON Schema with sorted keys at every depth and no whitespace", () => {
    assertEquals(canonicalJsonSchema(VECTOR_SCHEMA), VECTOR_CANONICAL);
  });

  it("hashes the shared test vector to its pinned identity", async () => {
    assertEquals(await schemaIdentitySha256(VECTOR_SCHEMA), VECTOR_SHA256);
  });

  it("ignores key order", async () => {
    const reordered = {
      additionalProperties: false,
      properties: { ticketText: { type: "string", minLength: 1 } },
      type: "object",
      required: ["ticketText"],
    };
    assertEquals(await schemaIdentitySha256(reordered), VECTOR_SHA256);
  });

  it("keeps array order significant", async () => {
    const a = await schemaIdentitySha256({ enum: ["a", "b"] });
    const b = await schemaIdentitySha256({ enum: ["b", "a"] });
    assertEquals(a === b, false);
  });

  it("hashes a contract schema through its JSON Schema form", async () => {
    const schema = defineSchema((v) => v.object({ ticketText: v.string() }))();
    const identity = await schemaIdentitySha256(schema);
    assertMatch(identity ?? "", /^[0-9a-f]{64}$/);
    assertEquals(canonicalJsonSchema(schema)?.includes('"ticketText"'), true);
  });

  it("returns null when no schema is declared", async () => {
    assertEquals(await schemaIdentitySha256(undefined), null);
    assertEquals(await schemaIdentitySha256(null), null);
  });

  it("keeps an own __proto__ key as a property of the canonical document", async () => {
    const withProto = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"}}}',
    );
    const withoutProto = { type: "object", properties: {} };

    assertEquals(
      canonicalJsonSchema(withProto),
      '{"properties":{"__proto__":{"type":"string"}},"type":"object"}',
    );
    assertEquals(
      (await schemaIdentitySha256(withProto)) === (await schemaIdentitySha256(withoutProto)),
      false,
    );
  });

  it("canonicalizes with the intrinsics captured before project code runs", () => {
    const hostObject = Object;
    const hostArray = Array;
    const hostJson = JSON;
    const keys = hostObject.keys;
    const isArray = hostArray.isArray;
    const stringify = hostJson.stringify;
    try {
      hostObject.keys = () => {
        throw new Error("replaced Object.keys");
      };
      hostArray.isArray = (() => false) as typeof Array.isArray;
      hostJson.stringify = (() => "forged") as typeof JSON.stringify;

      const canonical = canonicalJsonSchema(VECTOR_SCHEMA);

      hostJson.stringify = stringify;
      assertEquals(canonical, VECTOR_CANONICAL);
    } finally {
      hostObject.keys = keys;
      hostArray.isArray = isArray;
      hostJson.stringify = stringify;
    }
  });

  it("canonicalizes without inherited toJSON hooks", () => {
    const originalObjectToJson = Reflect.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    const originalArrayToJson = Reflect.getOwnPropertyDescriptor(Array.prototype, "toJSON");
    let canonical: string | undefined;
    try {
      Reflect.set(Object.prototype, "toJSON", () => "forged");
      Reflect.set(Array.prototype, "toJSON", () => {
        throw new Error("replaced Array.prototype.toJSON");
      });
      canonical = canonicalJsonSchema(VECTOR_SCHEMA);
    } finally {
      Reflect.deleteProperty(Object.prototype, "toJSON");
      Reflect.deleteProperty(Array.prototype, "toJSON");
      if (originalObjectToJson) {
        Reflect.defineProperty(Object.prototype, "toJSON", originalObjectToJson);
      }
      if (originalArrayToJson) {
        Reflect.defineProperty(Array.prototype, "toJSON", originalArrayToJson);
      }
    }

    assertEquals(canonical, VECTOR_CANONICAL);
  });

  it("hashes a raw JSON Schema that carries a __zod keyword as a raw schema", async () => {
    const raw = { type: "object", __zod: true };

    assertEquals(canonicalJsonSchema(raw), '{"__zod":true,"type":"object"}');
    assertMatch((await schemaIdentitySha256(raw)) ?? "", /^[0-9a-f]{64}$/);
  });
});
