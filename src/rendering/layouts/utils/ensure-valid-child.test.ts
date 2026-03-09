import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ensureValidChild } from "./ensure-valid-child.ts";
import * as React from "react";

describe("rendering/layouts/utils/ensure-valid-child", () => {
  describe("ensureValidChild", () => {
    it("should return null for null input", () => {
      assertEquals(ensureValidChild(null), null);
    });

    it("should return undefined for undefined input", () => {
      assertEquals(ensureValidChild(undefined), undefined);
    });

    it("should return strings as-is", () => {
      assertEquals(ensureValidChild("hello"), "hello");
    });

    it("should return empty string as-is", () => {
      assertEquals(ensureValidChild(""), "");
    });

    it("should return numbers as-is", () => {
      assertEquals(ensureValidChild(42), 42);
    });

    it("should return zero as-is", () => {
      assertEquals(ensureValidChild(0), 0);
    });

    it("should return arrays as-is", () => {
      const arr = ["a", "b"];
      assertEquals(ensureValidChild(arr), arr);
    });

    it("should return empty arrays as-is", () => {
      assertEquals(ensureValidChild([]), []);
    });

    it("should return valid React elements as-is", () => {
      const el = React.createElement("div", null, "test");
      const result = ensureValidChild(el);
      assertEquals(React.isValidElement(result), true);
    });

    it("should return React elements with props", () => {
      const el = React.createElement("span", { className: "foo" });
      const result = ensureValidChild(el);
      assertEquals(React.isValidElement(result), true);
    });

    it("should return null for non-element objects without React symbol", () => {
      const obj = { foo: "bar", baz: 123 };
      assertEquals(ensureValidChild(obj as never), null);
    });

    it("should return null for plain objects with random keys", () => {
      const obj = { a: 1, b: 2, c: 3 };
      assertEquals(ensureValidChild(obj as never), null);
    });

    it("should return null for non-object non-primitive types like boolean", () => {
      // booleans are not strings, numbers, null, undefined, or arrays
      // and typeof boolean !== "object", so they return null
      assertEquals(ensureValidChild(true as never), null);
      assertEquals(ensureValidChild(false as never), null);
    });

    it("should return null for functions", () => {
      const fn = () => {};
      assertEquals(ensureValidChild(fn as never), null);
    });

    it("should return null for symbols", () => {
      const sym = Symbol("test");
      assertEquals(ensureValidChild(sym as never), null);
    });

    it("should accept objects that look like React elements (structural match)", () => {
      // An object with $$typeof symbol, type, props, key should pass
      const fakeElement = {
        $$typeof: Symbol.for("react.element"),
        type: "div",
        props: {},
        key: null,
        ref: null,
      };
      const result = ensureValidChild(fakeElement as never);
      assertEquals(result, fakeElement);
    });

    it("should accept the second _React parameter without affecting behavior", () => {
      assertEquals(ensureValidChild("hello", {}), "hello");
      assertEquals(ensureValidChild(null, React), null);
    });

    it("should return nested arrays", () => {
      const nested = [["a"], ["b"]];
      assertEquals(ensureValidChild(nested), nested);
    });
  });
});
