import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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

    it("does not invoke top-level or nested accessors", () => {
      let getterCalls = 0;
      const nested: Record<string, unknown> = {};
      Object.defineProperty(nested, "secret", {
        enumerable: true,
        get() {
          getterCalls++;
          return "secret";
        },
      });
      const props: Record<string, unknown> = { safe: "value", nested };
      Object.defineProperty(props, "topLevel", {
        enumerable: true,
        get() {
          getterCalls++;
          return "secret";
        },
      });

      assertEquals(serializeProps(props), { safe: "value" });
      assertEquals(getterCalls, 0);
    });

    it("returns a detached deep snapshot", () => {
      const source = { nested: { count: 1 }, items: ["first"] };

      const snapshot = serializeProps({ source });
      source.nested.count = 2;
      source.items[0] = "changed";

      assertEquals(snapshot, {
        source: { nested: { count: 1 }, items: ["first"] },
      });
    });

    it("rejects custom prototypes without invoking custom serialization", () => {
      let toJsonCalls = 0;
      const custom = {
        toJSON() {
          toJsonCalls++;
          return { unsafe: true };
        },
      };

      assertEquals(
        serializeProps({ date: new Date(0), custom, safe: true }),
        { safe: true },
      );
      assertEquals(toJsonCalls, 0);
    });

    it("clones repeated shared values without misclassifying them as cycles", () => {
      const shared = { value: 1 };

      assertEquals(
        serializeProps({ data: { first: shared, second: shared } }),
        {
          data: {
            first: { value: 1 },
            second: { value: 1 },
          },
        },
      );
    });

    it("fails explicitly when the serialization depth budget is exceeded", () => {
      const root: Record<string, unknown> = {};
      let current = root;
      for (let depth = 0; depth < 70; depth++) {
        const child: Record<string, unknown> = {};
        current.child = child;
        current = child;
      }

      assertThrows(
        () => serializeProps({ root }),
        RangeError,
        "depth limit",
      );
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

    it("does not invoke inherited toJSON hooks", () => {
      let toJsonCalls = 0;
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        value() {
          toJsonCalls++;
          return { poisoned: true };
        },
      });

      let serialized: string;
      try {
        serialized = stringifyProps({ nested: { safe: true } });
      } finally {
        if (descriptor) {
          Object.defineProperty(Object.prototype, "toJSON", descriptor);
        } else {
          delete (Object.prototype as { toJSON?: unknown }).toJSON;
        }
      }

      assertEquals(JSON.parse(serialized), { nested: { safe: true } });
      assertEquals(toJsonCalls, 0);
    });

    it("fails explicitly when the serialized payload exceeds its byte budget", () => {
      assertThrows(
        () => stringifyProps({ value: "x".repeat(1024 * 1024 + 1) }),
        RangeError,
        "byte limit",
      );
    });
  });
});
