import "#veryfront/schemas/_test-setup.ts";
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

    it("drops markup-breaking and event-handler prop names while preserving valid names", () => {
      assertEquals(
        serializeProps({
          'x" http-equiv="refresh" content': "0;url=https://example.invalid",
          onClick: "alert(1)",
          ONLOAD: "alert(1)",
          className: "safe",
          htmlFor: "field",
          "aria-label": "Field",
          "data-test-id": "field",
          "xlink:href": "#icon",
        }),
        {
          className: "safe",
          htmlFor: "field",
          "aria-label": "Field",
          "data-test-id": "field",
          "xlink:href": "#icon",
        },
      );
    });

    it("should skip symbol values", () => {
      assertEquals(serializeProps({ sym: Symbol("test"), text: "ok" }), {
        text: "ok",
      });
    });

    it("keeps null and rejects undefined values that JSON would silently change", () => {
      const result = serializeProps({ a: null, b: undefined });
      assertEquals(result, { a: null });
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

    it("rejects non-finite numbers and non-plain object instances", () => {
      assertEquals(
        serializeProps({
          finite: 4,
          infinity: Infinity,
          nan: Number.NaN,
          date: new Date(0),
          map: new Map([["key", "value"]]),
        }),
        { finite: 4 },
      );
    });

    it("does not invoke getters while checking props", () => {
      let invoked = false;
      const props: Record<string, unknown> = { safe: "value" };
      Object.defineProperty(props, "dangerous", {
        enumerable: true,
        get() {
          invoked = true;
          throw new Error("getter must not run");
        },
      });

      assertEquals(serializeProps(props), { safe: "value" });
      assertEquals(invoked, false);
    });

    it("drops prototype-pollution keys at every depth", () => {
      const nested = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(nested, "__proto__", {
        enumerable: true,
        value: { polluted: true },
      });
      nested.safe = "yes";

      const result = serializeProps({ nested, constructor: "unsafe", ok: true });
      assertEquals(result, { nested: { safe: "yes" }, ok: true });
      assertEquals(({} as { polluted?: boolean }).polluted, undefined);
    });

    it("returns a detached JSON-safe clone", () => {
      const source = { nested: { value: 1 }, list: [1, 2] };
      const result = serializeProps({ source });
      source.nested.value = 2;
      source.list.push(3);

      assertEquals(result, { source: { nested: { value: 1 }, list: [1, 2] } });
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

    it("does not invoke toJSON hooks", () => {
      let invoked = false;
      const value = {
        toJSON() {
          invoked = true;
          return { secret: "leaked" };
        },
      };

      assertEquals(JSON.parse(stringifyProps({ value })), {});
      assertEquals(invoked, false);
    });
  });
});
