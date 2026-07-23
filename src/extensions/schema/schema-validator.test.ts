import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createZodAdapter } from "../../../extensions/ext-schema-zod/src/adapter.ts";
import type { InferSchema } from "./schema-validator.ts";

describe("SchemaValidator type contracts", () => {
  it("preserves optional fields added with extend", () => {
    const validator = createZodAdapter();
    const schema = validator.object({ required: validator.string() }).extend({
      optional: validator.string().optional(),
    });
    type Extended = InferSchema<typeof schema>;

    const value: Extended = { required: "value" };
    assertEquals(schema.parse(value), value);

    // @ts-expect-error The original required field remains required.
    const invalid: Extended = { optional: "value" };
    void invalid;
  });
});
