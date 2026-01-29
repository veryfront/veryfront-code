import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { deepInspectElement, type InspectionOptions } from "./element-inspector.ts";

describe("rendering/element-validator/element-inspector", () => {
  const defaultOptions: InspectionOptions = {
    maxDepth: 15,
    debugMode: false,
  };

  const debugOptions: InspectionOptions = {
    maxDepth: 15,
    debugMode: true,
  };

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
      const element = React.createElement("div", null, "Hello");
      deepInspectElement(element, "root", 0, defaultOptions);
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
      const invalidObj = { foo: "bar", baz: 123 };
      assertThrows(
        () => deepInspectElement(invalidObj, "root", 0, defaultOptions),
        Error,
        "Invalid React child",
      );
    });

    it("should stop at max depth", () => {
      const shallowOptions: InspectionOptions = { maxDepth: 0, debugMode: false };
      // At depth > maxDepth, function returns immediately without inspecting deeper
      const invalidObj = { foo: "bar" };
      // depth=1 > maxDepth=0 should not throw
      deepInspectElement(invalidObj, "root", 1, shallowOptions);
    });

    it("should respect maxDepth and stop recursing", () => {
      const shallowOptions: InspectionOptions = { maxDepth: 1, debugMode: false };
      const nested = React.createElement(
        "div",
        null,
        React.createElement("span", null, "deep"),
      );
      // Should not throw even with shallow depth
      deepInspectElement(nested, "root", 0, shallowOptions);
    });

    it("should not throw for object with React symbol", () => {
      const reactLike = {
        $$typeof: Symbol.for("react.element"),
        type: "div",
        props: {},
        key: null,
      };
      deepInspectElement(reactLike, "root", 0, defaultOptions);
    });

    it("should inspect element props recursively", () => {
      const element = React.createElement("div", {
        children: [
          React.createElement("span", { key: "a" }, "text"),
        ],
      });
      deepInspectElement(element, "root", 0, defaultOptions);
    });

    it("should work with debug mode enabled", () => {
      deepInspectElement("hello", "root", 0, debugOptions);
      deepInspectElement(null, "root", 0, debugOptions);
      const element = React.createElement("div", null, "test");
      deepInspectElement(element, "root", 0, debugOptions);
    });

    it("should inspect mixed arrays (elements and primitives)", () => {
      const mixed = [
        "text",
        React.createElement("br", { key: "br" }),
        42,
        null,
      ];
      deepInspectElement(mixed, "root", 0, defaultOptions);
    });
  });
});
