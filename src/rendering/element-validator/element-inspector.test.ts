import "#veryfront/schemas/_test-setup.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { deepInspectElement, type InspectionOptions } from "./element-inspector.ts";

describe("rendering/element-validator/element-inspector", () => {
  const defaultOptions: InspectionOptions = { maxDepth: 15, debugMode: false };
  const debugOptions: InspectionOptions = { maxDepth: 15, debugMode: true };

  describe("deepInspectElement", () => {
    it("should accept null without throwing", () => {
      deepInspectElement(null, "root", 0, defaultOptions);
    });

    it("should accept undefined without throwing", () => {
      deepInspectElement(undefined, "root", 0, defaultOptions);
    });

    it("should accept string primitives", () => {
      deepInspectElement("hello", "root", 0, defaultOptions);
    });

    it("should accept number primitives", () => {
      deepInspectElement(42, "root", 0, defaultOptions);
    });

    it("should accept boolean primitives", () => {
      deepInspectElement(true, "root", 0, defaultOptions);
    });

    it("should accept valid React elements", () => {
      deepInspectElement(React.createElement("div", null, "Hello"), "root", 0, defaultOptions);
    });

    it("should accept React elements with children", () => {
      const element = React.createElement(
        "div",
        null,
        React.createElement("span", null, "child"),
      );
      deepInspectElement(element, "root", 0, defaultOptions);
    });

    it("should accept arrays of valid elements", () => {
      const elements = [
        React.createElement("div", { key: "1" }, "one"),
        React.createElement("span", { key: "2" }, "two"),
      ];
      deepInspectElement(elements, "root", 0, defaultOptions);
    });

    it("should accept arrays of primitives", () => {
      deepInspectElement(["hello", 42, true, null], "root", 0, defaultOptions);
    });

    it("should throw for invalid plain objects used as children", () => {
      assertThrows(
        () => deepInspectElement({ foo: "bar", baz: 123 }, "root", 0, defaultOptions),
        Error,
        "Invalid React child",
      );
    });

    it("should stop at max depth", () => {
      const shallowOptions: InspectionOptions = { maxDepth: 0, debugMode: false };
      deepInspectElement({ foo: "bar" }, "root", 1, shallowOptions);
    });

    it("should respect maxDepth and stop recursing", () => {
      const shallowOptions: InspectionOptions = { maxDepth: 1, debugMode: false };
      const nested = React.createElement(
        "div",
        null,
        React.createElement("span", null, "deep"),
      );
      deepInspectElement(nested, "root", 0, shallowOptions);
    });

    it("should not throw for object with React symbol", () => {
      deepInspectElement(
        { $$typeof: Symbol.for("react.element"), type: "div", props: {}, key: null },
        "root",
        0,
        defaultOptions,
      );
    });

    it("should inspect element props recursively", () => {
      const element = React.createElement("div", {
        children: [React.createElement("span", { key: "a" }, "text")],
      });
      deepInspectElement(element, "root", 0, defaultOptions);
    });

    it("should work with debug mode enabled", () => {
      deepInspectElement("hello", "root", 0, debugOptions);
      deepInspectElement(null, "root", 0, debugOptions);
      deepInspectElement(React.createElement("div", null, "test"), "root", 0, debugOptions);
    });

    it("should inspect mixed arrays (elements and primitives)", () => {
      const mixed = ["text", React.createElement("br", { key: "br" }), 42, null];
      deepInspectElement(mixed, "root", 0, defaultOptions);
    });

    it("does not invoke accessor-backed React props", () => {
      let reads = 0;
      const props = Object.defineProperty({}, "children", {
        enumerable: true,
        get() {
          reads++;
          throw new Error("must not execute");
        },
      });
      const element = {
        $$typeof: Symbol.for("react.element"),
        type: "div",
        key: null,
        props,
      };

      assertThrows(
        () => deepInspectElement(element, "root", 0, defaultOptions),
        TypeError,
        "data properties",
      );
      if (reads !== 0) throw new Error(`Expected zero accessor reads, received ${reads}`);
    });

    it("does not invoke invalid-child diagnostic accessors", () => {
      let reads = 0;
      const value = Object.defineProperties({}, {
        type: {
          enumerable: true,
          get() {
            reads++;
            throw new Error("must not execute");
          },
        },
        constructor: {
          enumerable: false,
          get() {
            reads++;
            throw new Error("must not execute");
          },
        },
        toJSON: {
          enumerable: true,
          value() {
            reads++;
            throw new Error("must not execute");
          },
        },
      });

      assertThrows(
        () => deepInspectElement(value, "root", 0, defaultOptions),
        Error,
        "Invalid React child",
      );
      if (reads !== 0) throw new Error(`Expected zero diagnostic-hook calls, received ${reads}`);
    });

    it("rejects trees that exceed the fixed inspection work budget", () => {
      assertThrows(
        () => deepInspectElement(new Array(10_001).fill(null), "root", 0, defaultOptions),
        RangeError,
        "node limit",
      );
    });

    it("rejects unsafe configured depth limits", () => {
      assertThrows(
        () =>
          deepInspectElement(
            null,
            "root",
            0,
            { maxDepth: 65, debugMode: false },
          ),
        RangeError,
        "at most 64",
      );
    });

    it("rejects cyclic React child structures", () => {
      const children: unknown[] = [];
      children.push(children);

      assertThrows(
        () => deepInspectElement(children, "root", 0, defaultOptions),
        TypeError,
        "cyclic",
      );
    });
  });
});
