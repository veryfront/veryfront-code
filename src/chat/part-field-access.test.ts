import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getNonEmptyStringField,
  getOptionalStringField,
  getStringField,
  isRecord,
  stringifyUnknown,
  toJsonValue,
  toRecord,
} from "./part-field-access.ts";

describe("part-field-access", () => {
  it("treats arrays and null as non-records", () => {
    assertEquals(isRecord({}), true);
    assertEquals(isRecord([]), false);
    assertEquals(isRecord(null), false);
    assertEquals(isRecord("x"), false);
  });

  it("falls back when the field is absent or not a string", () => {
    assertEquals(getStringField({ a: "v" }, "a", "fb"), "v");
    assertEquals(getStringField({ a: 1 }, "a", "fb"), "fb");
    assertEquals(getStringField(null, "a", "fb"), "fb");
  });

  it("distinguishes optional from non-empty string fields", () => {
    assertEquals(getOptionalStringField({ a: "" }, "a"), "");
    assertEquals(getNonEmptyStringField({ a: "" }, "a"), undefined);
    assertEquals(getNonEmptyStringField({ a: "v" }, "a"), "v");
  });

  it("converts non-records to an empty record", () => {
    assertEquals(toRecord({ a: 1 }), { a: 1 });
    assertEquals(toRecord(null), {});
    assertEquals(toRecord("x"), {});
  });

  it("returns strings unchanged and stringifies other primitives", () => {
    assertEquals(stringifyUnknown("already"), "already");
    assertEquals(stringifyUnknown(undefined), "undefined");
    assertEquals(stringifyUnknown(10n), "10");
  });

  it("stringifies records and arrays through the JSON fallback", () => {
    assertEquals(stringifyUnknown({ a: 1 }), '{"a":1}');
    assertEquals(stringifyUnknown([1, "b"]), '[1,"b"]');
    assertEquals(stringifyUnknown(null), "null");
  });

  it("converts values into JSON-safe values", () => {
    assertEquals(toJsonValue({ a: [1, "b"] }), { a: [1, "b"] });
    assertEquals(toJsonValue(null), null);
  });
});
