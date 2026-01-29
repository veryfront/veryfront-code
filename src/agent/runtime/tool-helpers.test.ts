import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseToolArgs } from "./tool-helpers.ts";

describe("tool-helpers", () => {
  describe("parseToolArgs", () => {
    it("parses a valid JSON string into args", () => {
      const result = parseToolArgs('{"key": "value", "num": 42}');
      assertEquals(result.args, { key: "value", num: 42 });
      assertEquals(result.error, undefined);
    });

    it("passes through an object directly", () => {
      const input = { foo: "bar", nested: { a: 1 } };
      const result = parseToolArgs(input);
      assertEquals(result.args, input);
      assertEquals(result.error, undefined);
    });

    it("returns error for invalid JSON string", () => {
      const result = parseToolArgs("not-valid-json");
      assertEquals(result.args, {});
      assertEquals(typeof result.error, "string");
    });

    it("returns error for JSON array", () => {
      const result = parseToolArgs("[1, 2, 3]");
      assertEquals(result.args, {});
      assertEquals(result.error, "Tool call arguments must be a JSON object");
    });

    it("returns error for JSON primitive string", () => {
      const result = parseToolArgs('"hello"');
      assertEquals(result.args, {});
      assertEquals(result.error, "Tool call arguments must be a JSON object");
    });

    it("returns error for JSON null", () => {
      const result = parseToolArgs("null");
      assertEquals(result.args, {});
      assertEquals(result.error, "Tool call arguments must be a JSON object");
    });

    it("handles empty object", () => {
      const result = parseToolArgs("{}");
      assertEquals(result.args, {});
      assertEquals(result.error, undefined);
    });

    it("handles empty object passed directly", () => {
      const result = parseToolArgs({});
      assertEquals(result.args, {});
      assertEquals(result.error, undefined);
    });
  });
});
