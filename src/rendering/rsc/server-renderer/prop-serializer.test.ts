import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { serializeProps, stringifyProps } from "./prop-serializer.ts";

describe("rendering/rsc/server-renderer/prop-serializer", () => {
  describe("serializeProps", () => {
    it("should pass through serializable primitives", () => {
      const result = serializeProps({ name: "Alice", count: 42, active: true });
      assertEquals(result, { name: "Alice", count: 42, active: true });
    });

    it("should skip children prop", () => {
      const result = serializeProps({ children: "hello", title: "Test" });
      assertEquals(result, { title: "Test" });
    });

    it("should skip function values", () => {
      const result = serializeProps({ onClick: () => {}, label: "btn" });
      assertEquals(result, { label: "btn" });
    });

    it("should skip symbol values", () => {
      const result = serializeProps({ sym: Symbol("test"), text: "ok" });
      assertEquals(result, { text: "ok" });
    });

    it("should keep null and undefined values", () => {
      const result = serializeProps({ a: null, b: undefined });
      assertEquals(result.a, null);
      assertEquals(result.b, undefined);
    });

    it("should keep nested serializable objects", () => {
      const result = serializeProps({ data: { x: 1, y: 2 } });
      assertEquals(result, { data: { x: 1, y: 2 } });
    });

    it("should skip objects containing functions", () => {
      const result = serializeProps({ handler: { fn: () => {} }, ok: "yes" });
      assertEquals(result, { ok: "yes" });
    });

    it("should return empty for all-skipped props", () => {
      const result = serializeProps({ children: "x", onClick: () => {} });
      assertEquals(Object.keys(result).length, 0);
    });
  });

  describe("stringifyProps", () => {
    it("should serialize simple props to JSON", () => {
      const result = stringifyProps({ name: "test", value: 42 });
      assertEquals(JSON.parse(result), { name: "test", value: 42 });
    });

    it("should handle circular references", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      const result = stringifyProps(obj);
      const parsed = JSON.parse(result);
      assertEquals(parsed.a, 1);
      assertEquals(parsed.self, undefined);
    });

    it("should handle null values", () => {
      const result = stringifyProps({ x: null });
      assertEquals(JSON.parse(result), { x: null });
    });

    it("should handle nested objects", () => {
      const result = stringifyProps({ a: { b: { c: 1 } } });
      assertEquals(JSON.parse(result), { a: { b: { c: 1 } } });
    });

    it("should handle arrays", () => {
      const result = stringifyProps({ items: [1, 2, 3] });
      assertEquals(JSON.parse(result), { items: [1, 2, 3] });
    });
  });
});
