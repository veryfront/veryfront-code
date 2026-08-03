import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseToolInputObject } from "./tool-input.ts";

describe("agent/tool-input parseToolInputObject", () => {
  it("returns a record object input as-is without re-parsing", () => {
    const input = { key: "value", nested: { a: 1 } };
    assertEquals(parseToolInputObject(input), input);
  });

  it("parses a valid JSON object string", () => {
    assertEquals(parseToolInputObject('{"key":"value"}'), { key: "value" });
    assertEquals(parseToolInputObject('{"a":1,"b":true,"c":null}'), { a: 1, b: true, c: null });
  });

  it("returns {} for malformed JSON strings", () => {
    assertEquals(parseToolInputObject("{invalid json}"), {});
    assertEquals(parseToolInputObject("{"), {});
    assertEquals(parseToolInputObject("not json at all"), {});
  });

  it("returns {} when the JSON value is an array", () => {
    assertEquals(parseToolInputObject("[1,2,3]"), {});
    assertEquals(parseToolInputObject("[]"), {});
  });

  it("returns {} when the JSON value is a number", () => {
    assertEquals(parseToolInputObject("42"), {});
    assertEquals(parseToolInputObject("0"), {});
  });

  it("returns {} when the JSON value is a JSON string literal", () => {
    assertEquals(parseToolInputObject('"hello"'), {});
  });

  it("returns {} when the JSON value is null", () => {
    assertEquals(parseToolInputObject("null"), {});
  });

  it("returns {} for an empty string", () => {
    assertEquals(parseToolInputObject(""), {});
  });

  it("returns {} for non-string, non-record inputs", () => {
    assertEquals(parseToolInputObject(null), {});
    assertEquals(parseToolInputObject(undefined), {});
    assertEquals(parseToolInputObject(42), {});
    assertEquals(parseToolInputObject(true), {});
  });
});
