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

    it("should throw for an invalid object inside a children array", () => {
      assertThrows(
        () => deepInspectElement(["text", { bad: 1 }], "root", 0, defaultOptions),
        Error,
        "root[1]",
        "an invalid object inside a children array must be reported with its array index path",
      );
    });

    it("should throw for an invalid object inside an element's array children", () => {
      // React's prop types reject a plain object as a child, which is exactly the
      // runtime shape this inspector has to report on, so the array is widened.
      const invalidChildren = ["ok", { bad: 1 }] as unknown as React.ReactNode;

      assertThrows(
        () =>
          deepInspectElement(
            React.createElement("div", null, invalidChildren),
            "root",
            0,
            defaultOptions,
          ),
        Error,
        "root.children[1]",
        "invalid children inside an element's array children must be reported",
      );
    });

    it("should stop at max depth", () => {
      const shallowOptions: InspectionOptions = { maxDepth: 0, debugMode: false };
      deepInspectElement({ foo: "bar" }, "root", 1, shallowOptions);
    });

    it("should inspect a node at exactly maxDepth but skip anything deeper", () => {
      const opts: InspectionOptions = { maxDepth: 2, debugMode: false };

      assertThrows(
        () => deepInspectElement({ bad: 1 }, "root", 2, opts),
        Error,
        "Invalid React child",
        "a node at exactly maxDepth must still be inspected",
      );

      // One level past maxDepth is skipped, so the same invalid object is ignored.
      deepInspectElement({ bad: 1 }, "root", 3, opts);
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

    it("skips objects carrying an unrecognised React symbol instead of throwing", () => {
      // Bundled or legacy React copies use a numeric $$typeof.
      deepInspectElement({ $$typeof: 0xeac7 }, "root", 0, defaultOptions);
      deepInspectElement({ $$typeof: Symbol.for("react.future_thing") }, "root", 0, defaultOptions);

      assertThrows(
        () => deepInspectElement({ $$typeof: "not-a-symbol" }, "root", 0, defaultOptions),
        Error,
        "Invalid React child",
        "a non-symbol, non-numeric $$typeof is still an invalid child",
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
  });
});
