import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as common from "./common.ts";
import * as define from "./define.ts";
import * as jsonSchema from "./json-schema.ts";
import * as lazy from "./lazy.ts";
import * as primitives from "./primitives.ts";
import * as schemas from "./index.ts";
import * as publicSchemas from "veryfront/schemas";
import type { InferSchema, Schema } from "veryfront/schemas";

const expectedRuntimeExports = [
  "CommonSchemas",
  "defineSchema",
  "getAbsolutePathSchema",
  "getDateRangeSchema",
  "getEmailSchema",
  "getFilePathSchema",
  "getHexColorSchema",
  "getJsonValueSchema",
  "getNonEmptyStringSchema",
  "getNonNegativeIntSchema",
  "getPaginationSchema",
  "getPhoneNumberSchema",
  "getPortNumberSchema",
  "getPositiveIntSchema",
  "getSemverSchema",
  "getSlugSchema",
  "getStrongPasswordSchema",
  "getTimestampSchema",
  "getUrlSchema",
  "getUuidSchema",
  "lazySchema",
  "schemaIsOptional",
  "schemaToJsonSchema",
].sort();

describe("schemas public contracts", () => {
  it("preserves the exact runtime export surface", () => {
    assertEquals(Object.keys(schemas).sort(), expectedRuntimeExports);
  });

  it("keeps public exports wired to their source modules", () => {
    assertEquals(schemas.CommonSchemas, common.CommonSchemas);
    assertEquals(schemas.defineSchema, define.defineSchema);
    assertEquals(schemas.lazySchema, lazy.lazySchema);
    assertEquals(schemas.schemaIsOptional, jsonSchema.isOptionalSchema);
    assertEquals(schemas.schemaToJsonSchema, jsonSchema.schemaToJsonSchema);
    assertEquals(schemas.getPaginationSchema, common.getPaginationSchema);
    assertEquals(schemas.getJsonValueSchema, primitives.getJsonValueSchema);
  });

  it("keeps veryfront/schemas aligned with the source barrel", () => {
    assertEquals(Object.keys(publicSchemas).sort(), expectedRuntimeExports);
    assertEquals(publicSchemas.CommonSchemas, schemas.CommonSchemas);
    assertEquals(publicSchemas.defineSchema, schemas.defineSchema);
    assertEquals(publicSchemas.getJsonValueSchema, schemas.getJsonValueSchema);
  });

  it("exposes schema inference types from the public entrypoint", () => {
    const schema: Schema<string> = publicSchemas.getUuidSchema();
    const value: InferSchema<typeof schema> = "550e8400-e29b-41d4-a716-446655440000";

    assertEquals(schema.parse(value), value);
  });
});
