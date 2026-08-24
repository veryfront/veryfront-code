import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { ElementValidator } from "./validator-core.ts";

describe("rendering/element-validator/validator-core", () => {
  describe("ElementValidator", () => {
    it("should create with default options", () => {
      const validator = new ElementValidator();
      assertEquals(validator instanceof ElementValidator, true);
    });

    it("should create with custom options", () => {
      const validator = new ElementValidator({ maxDepth: 5, debugMode: true });
      assertEquals(validator instanceof ElementValidator, true);
    });

    describe("deepInspectElement", () => {
      it("should accept valid React elements", () => {
        const validator = new ElementValidator();
        validator.deepInspectElement(React.createElement("div", null, "Hello"));
      });

      it("should accept primitives", () => {
        const validator = new ElementValidator();
        validator.deepInspectElement("hello");
        validator.deepInspectElement(42);
        validator.deepInspectElement(null);
        validator.deepInspectElement(undefined);
        validator.deepInspectElement(true);
      });

      it("should throw on invalid plain objects", () => {
        const validator = new ElementValidator();
        assertThrows(
          () => validator.deepInspectElement({ key: "value", num: 42 }),
          Error,
          "Invalid React child",
        );
      });

      it("should forward the caller path into inspection errors", () => {
        const validator = new ElementValidator();
        assertThrows(
          () =>
            validator.deepInspectElement(
              React.createElement("div", null, {} as React.ReactNode),
              "page.layout",
              0,
            ),
          Error,
          "Invalid React child found at page.layout.children",
          "the caller-supplied path must be forwarded into the inspection error",
        );
      });

      it("should respect maxDepth option", () => {
        const validator = new ElementValidator({ maxDepth: 0 });
        validator.deepInspectElement({ foo: "bar" }, "root", 1);
      });

      it("should reach invalid objects nested five levels down by default", () => {
        let tree: React.ReactNode = { bad: "object" } as unknown as React.ReactNode;
        for (let i = 0; i < 5; i++) tree = React.createElement("div", null, tree);
        assertThrows(
          () => new ElementValidator().deepInspectElement(tree),
          Error,
          "Invalid React child",
          "the default maxDepth must be deep enough to reach an invalid object five levels down",
        );
      });

      it("should stop before that depth when maxDepth narrows it", () => {
        let tree: React.ReactNode = { bad: "object" } as unknown as React.ReactNode;
        for (let i = 0; i < 5; i++) tree = React.createElement("div", null, tree);
        // maxDepth 2 must cut the walk short before the invalid object at depth 5.
        new ElementValidator({ maxDepth: 2 }).deepInspectElement(tree);
      });
    });

    describe("ensureValidReactElement", () => {
      it("should return a React element when given one", () => {
        const validator = new ElementValidator();
        const result = validator.ensureValidReactElement(
          React.createElement("div", null, "Hello"),
        );
        assertEquals(React.isValidElement(result), true);
        assertEquals(result.type, "div");
      });

      it("should wrap non-element values in Fragment", () => {
        const validator = new ElementValidator();
        const result = validator.ensureValidReactElement("text");
        assertEquals(React.isValidElement(result), true);
        assertEquals(result.type, React.Fragment);
      });

      it("should wrap null in Fragment", () => {
        const validator = new ElementValidator();
        const result = validator.ensureValidReactElement(null);
        assertEquals(React.isValidElement(result), true);
      });

      it("should perform inspection when inspectionEnabled is true", () => {
        const validator = new ElementValidator();
        const result = validator.ensureValidReactElement(
          React.createElement("div", null, "safe"),
          true,
        );
        assertEquals(React.isValidElement(result), true);
      });

      it("should default to lenient normalization when inspection is not requested", () => {
        const validator = new ElementValidator();
        const el = React.createElement(
          "div",
          null,
          { not: "a react child" } as unknown as React.ReactNode,
        );
        const result = validator.ensureValidReactElement(el);
        assertEquals(
          React.isValidElement(result),
          true,
          "inspection must be off by default, so an invalid child passes through untouched",
        );
        assertEquals(result.type, "div", "the original element must be returned unwrapped");
      });

      it("should throw during inspection for invalid children", () => {
        const validator = new ElementValidator();
        const invalid = { not: "a react child" };
        const el = React.createElement("div", null, invalid as React.ReactNode);
        assertThrows(
          () => validator.ensureValidReactElement(el, true),
          Error,
          "Invalid React child",
        );
      });
    });
  });
});
