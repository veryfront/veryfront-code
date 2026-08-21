import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isInferredJsonSchemaObject } from "./schema-input.ts";

describe("schema-input", () => {
  it("recognizes legacy JSON Schema keywords as schema evidence", () => {
    for (
      const keyword of [
        "additionalItems",
        "dependencies",
        "$recursiveAnchor",
        "$recursiveRef",
      ]
    ) {
      assertEquals(isInferredJsonSchemaObject({ [keyword]: true }), true);
    }
  });
});
