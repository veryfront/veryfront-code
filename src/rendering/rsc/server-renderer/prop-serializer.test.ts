import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { serializeProps, stringifyProps } from "./prop-serializer.ts";

describe("rendering/rsc/server-renderer/prop-serializer", () => {
  describe("serializeProps", () => {
    it("should pass through serializable primitives", () => {
      assertEquals(serializeProps({ name: "Alice", count: 42, active: true }), {
        name: "Alice",
        count: 42,
        active: true,
      });
    });

    it("should skip children prop", () => {
      assertEquals(serializeProps({ children: "hello", title: "Test" }), {
        title: "Test",
      });
    });

    it("should skip function values", () => {
      assertEquals(serializeProps({ onClick: () => {}, label: "btn" }), {
        label: "btn",
      });
    });

    it("should skip symbol values", () => {
      assertEquals(serializeProps({ sym: Symbol("test"), text: "ok" }), {
        text: "ok",
      });
    });

    it("should keep null and undefined values", () => {
      const result = serializeProps({ a: null, b: undefined });
      assertEquals(result, { a: null, b: undefined });
    });

    it("should keep nested serializable objects", () => {
      assertEquals(serializeProps({ data: { x: 1, y: 2 } }), {
        data: { x: 1, y: 2 },
      });
    });

    it("should skip objects containing functions", () => {
      assertEquals(serializeProps({ handler: { fn: () => {} }, ok: "yes" }), {
        ok: "yes",
      });
    });

    it("should return empty for all-skipped props", () => {
      assertEquals(serializeProps({ children: "x", onClick: () => {} }), {});
    });
  });

  describe("stringifyProps", () => {
    it("should serialize simple props to JSON", () => {
      assertEquals(JSON.parse(stringifyProps({ name: "test", value: 42 })), {
        name: "test",
        value: 42,
      });
    });

    it("should handle circular references", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;

      const parsed = JSON.parse(stringifyProps(obj));
      assertEquals(parsed, { a: 1 });
    });

    it("should handle null values", () => {
      assertEquals(JSON.parse(stringifyProps({ x: null })), { x: null });
    });

    it("should handle nested objects", () => {
      assertEquals(JSON.parse(stringifyProps({ a: { b: { c: 1 } } })), {
        a: { b: { c: 1 } },
      });
    });

    it("should handle arrays", () => {
      assertEquals(JSON.parse(stringifyProps({ items: [1, 2, 3] })), {
        items: [1, 2, 3],
      });
    });
  });
});
