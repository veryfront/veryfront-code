// Replacing a shared String intrinsic is a process-global integration effect.
import { boundedJsonByteLength } from "#veryfront/schemas/json-value.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

it("keeps UTF-8 counts independent of later string intrinsic replacement", () => {
  const original = String.prototype.charCodeAt;
  try {
    String.prototype.charCodeAt = () => {
      throw new Error("caller replacement");
    };
    assertEquals(boundedJsonByteLength("é中😀"), 11);
  } finally {
    String.prototype.charCodeAt = original;
  }
});
