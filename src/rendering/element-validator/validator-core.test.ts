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

      it("should use custom path and depth", () => {
        const validator = new ElementValidator();
        validator.deepInspectElement(
          React.createElement("span", null, "test"),
          "custom.path",
          2,
        );
      });

      it("should respect maxDepth option", () => {
        const validator = new ElementValidator({ maxDepth: 0 });
        validator.deepInspectElement({ foo: "bar" }, "root", 1);
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
