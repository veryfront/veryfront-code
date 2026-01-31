import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import * as React from "react";
import {
  getElementTypeName,
  getObjectKeys,
  getObjectSample,
  hasReactSymbol,
  isValidPrimitive,
} from "./primitive-checks.ts";

describe("primitive-checks", () => {
  describe("isValidPrimitive", () => {
    it("should return true for null", () => {
      expect(isValidPrimitive(null)).toBe(true);
    });

    it("should return true for undefined", () => {
      expect(isValidPrimitive(undefined)).toBe(true);
    });

    it("should return true for strings", () => {
      expect(isValidPrimitive("")).toBe(true);
      expect(isValidPrimitive("hello")).toBe(true);
      expect(isValidPrimitive("123")).toBe(true);
    });

    it("should return true for numbers", () => {
      expect(isValidPrimitive(0)).toBe(true);
      expect(isValidPrimitive(42)).toBe(true);
      expect(isValidPrimitive(-10)).toBe(true);
      expect(isValidPrimitive(3.14)).toBe(true);
      expect(isValidPrimitive(NaN)).toBe(true);
      expect(isValidPrimitive(Infinity)).toBe(true);
    });

    it("should return true for booleans", () => {
      expect(isValidPrimitive(true)).toBe(true);
      expect(isValidPrimitive(false)).toBe(true);
    });

    it("should return false for objects", () => {
      expect(isValidPrimitive({})).toBe(false);
      expect(isValidPrimitive({ foo: "bar" })).toBe(false);
    });

    it("should return false for arrays", () => {
      expect(isValidPrimitive([])).toBe(false);
      expect(isValidPrimitive([1, 2, 3])).toBe(false);
    });

    it("should return false for functions", () => {
      expect(isValidPrimitive(() => {})).toBe(false);
      expect(isValidPrimitive(function foo() {})).toBe(false);
    });

    it("should return false for symbols", () => {
      expect(isValidPrimitive(Symbol("test"))).toBe(false);
    });

    it("should return false for React elements", () => {
      const element = React.createElement("div", null, "content");
      expect(isValidPrimitive(element)).toBe(false);
    });
  });

  describe("hasReactSymbol", () => {
    it("should return true for objects with symbol $$typeof", () => {
      expect(hasReactSymbol({ $$typeof: Symbol.for("react.element") })).toBe(true);
    });

    it("should return true for objects with numeric $$typeof", () => {
      expect(hasReactSymbol({ $$typeof: 0xeac7 })).toBe(true);
    });

    it("should return false for objects without $$typeof", () => {
      expect(hasReactSymbol({ foo: "bar" })).toBe(false);
    });

    it("should return false for objects with non-symbol/non-number $$typeof", () => {
      expect(hasReactSymbol({ $$typeof: "string" })).toBe(false);
    });

    it("should return true for actual React elements", () => {
      const element = React.createElement("div", null, "content") as unknown as Record<
        string,
        unknown
      >;
      expect(hasReactSymbol(element)).toBe(true);
    });
  });

  describe("getElementTypeName", () => {
    it("should return component name for named function components", () => {
      function MyComponent() {
        return React.createElement("div", null, "test");
      }
      const element = React.createElement(MyComponent, null);
      expect(getElementTypeName(element)).toBe("MyComponent");
    });

    it("should return displayName if available", () => {
      function Component() {
        return React.createElement("div", null, "test");
      }
      Component.displayName = "CustomDisplayName";
      const element = React.createElement(Component, null);
      expect(getElementTypeName(element)).toBe("Component");
    });

    it("should return <Anonymous> for anonymous function components", () => {
      const element = React.createElement(() => React.createElement("div", null, "test"), null);
      expect(getElementTypeName(element)).toBe("<Anonymous>");
    });

    it("should return tag name for intrinsic elements", () => {
      expect(getElementTypeName(React.createElement("div", null, "test"))).toBe("div");
      expect(getElementTypeName(React.createElement("span", null, "test"))).toBe("span");
    });

    it("should handle class components", () => {
      class ClassComponent extends React.Component {
        override render() {
          return React.createElement("div", null, "test");
        }
      }
      const element = React.createElement(ClassComponent, null);
      expect(getElementTypeName(element)).toBe("ClassComponent");
    });
  });

  describe("getObjectKeys", () => {
    it("should return empty array for null", () => {
      expect(getObjectKeys(null)).toEqual([]);
    });

    it("should return empty array for undefined", () => {
      expect(getObjectKeys(undefined)).toEqual([]);
    });

    it("should return empty array for primitives", () => {
      expect(getObjectKeys(42)).toEqual([]);
      expect(getObjectKeys("string")).toEqual([]);
      expect(getObjectKeys(true)).toEqual([]);
    });

    it("should return keys for simple objects", () => {
      const keys = getObjectKeys({ foo: 1, bar: 2, baz: 3 });
      expect(keys).toContain("foo");
      expect(keys).toContain("bar");
      expect(keys).toContain("baz");
      expect(keys.length).toBe(3);
    });

    it("should limit to first 15 keys", () => {
      const obj: Record<string, number> = {};
      for (let i = 0; i < 20; i++) obj[`key${i}`] = i;

      expect(getObjectKeys(obj).length).toBe(15);
    });

    it("should work with arrays", () => {
      const keys = getObjectKeys([1, 2, 3]);
      expect(keys).toContain("0");
      expect(keys).toContain("1");
      expect(keys).toContain("2");
    });

    it("should return empty array for objects with no keys", () => {
      expect(getObjectKeys({})).toEqual([]);
    });
  });

  describe("getObjectSample", () => {
    it("should return JSON string for simple objects", () => {
      const sample = getObjectSample({ foo: "bar", num: 42 });
      expect(sample).toContain('"foo"');
      expect(sample).toContain('"bar"');
      expect(sample).toContain('"num"');
      expect(sample).toContain("42");
    });

    it("should return JSON string for arrays", () => {
      expect(getObjectSample([1, 2, 3])).toBe("[\n  1,\n  2,\n  3\n]");
    });

    it("should return JSON string for null", () => {
      expect(getObjectSample(null)).toBe("null");
    });

    it("should return JSON string for primitives", () => {
      expect(getObjectSample(42)).toBe("42");
      expect(getObjectSample("test")).toBe('"test"');
      expect(getObjectSample(true)).toBe("true");
    });

    it("should limit output to 500 characters", () => {
      const largeObj: Record<string, string> = {};
      for (let i = 0; i < 100; i++) largeObj[`key${i}`] = `value${i}`.repeat(10);

      expect(getObjectSample(largeObj).length).toBeLessThanOrEqual(500);
    });

    it("should handle circular references", () => {
      const obj: Record<string, unknown> = { foo: "bar" };
      obj.self = obj;
      expect(getObjectSample(obj)).toBe("[Unable to stringify]");
    });

    it("should handle objects that throw on stringify", () => {
      const obj = {
        get foo() {
          throw new Error("Cannot access");
        },
      };
      expect(getObjectSample(obj)).toBe("[Unable to stringify]");
    });

    it("should format JSON with proper indentation", () => {
      const sample = getObjectSample({ nested: { value: 42 } });
      expect(sample).toContain("  ");
      expect(sample).toContain("\n");
    });

    it("should handle undefined", () => {
      expect(getObjectSample(undefined)).toBe("[Unable to stringify]");
    });
  });
});
