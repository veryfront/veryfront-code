import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { ensureValidReactElement, type NormalizationOptions } from "./element-normalizer.ts";
import type { InspectionOptions } from "./element-inspector.ts";

describe("rendering/element-validator/element-normalizer", () => {
  const inspectionOptions: InspectionOptions = {
    maxDepth: 15,
    debugMode: false,
  };

  const baseOptions: NormalizationOptions = {
    inspectionEnabled: false,
    debugMode: false,
    inspectionOptions,
  };

  describe("ensureValidReactElement", () => {
    it("should return a React element as-is when given a valid element", () => {
      const el = React.createElement("div", null, "Hello");
      const result = ensureValidReactElement(el, baseOptions);
      assertEquals(React.isValidElement(result), true);
      assertEquals(result.type, "div");
    });

    it("should wrap a string in a Fragment", () => {
      const result = ensureValidReactElement("hello world", baseOptions);
      assertEquals(React.isValidElement(result), true);
      assertEquals(result.type, React.Fragment);
    });

    it("should wrap a number in a Fragment", () => {
      const result = ensureValidReactElement(42, baseOptions);
      assertEquals(React.isValidElement(result), true);
      assertEquals(result.type, React.Fragment);
    });

    it("should wrap null in a Fragment", () => {
      const result = ensureValidReactElement(null, baseOptions);
      assertEquals(React.isValidElement(result), true);
    });

    it("should wrap undefined in a Fragment", () => {
      const result = ensureValidReactElement(undefined, baseOptions);
      assertEquals(React.isValidElement(result), true);
    });

    it("should wrap boolean in a Fragment", () => {
      const result = ensureValidReactElement(false, baseOptions);
      assertEquals(React.isValidElement(result), true);
    });

    it("should wrap an array of elements in a Fragment", () => {
      const arr = [
        React.createElement("div", { key: "1" }, "a"),
        React.createElement("span", { key: "2" }, "b"),
      ];
      const result = ensureValidReactElement(arr, baseOptions);
      assertEquals(React.isValidElement(result), true);
    });

    it("should perform deep inspection when enabled", () => {
      const el = React.createElement("div", null, "Hello");
      const opts: NormalizationOptions = {
        inspectionEnabled: true,
        debugMode: false,
        inspectionOptions,
      };
      const result = ensureValidReactElement(el, opts);
      assertEquals(React.isValidElement(result), true);
    });

    it("should throw during deep inspection of invalid objects", () => {
      const invalidChild = { some: "object" };
      const el = React.createElement("div", null, invalidChild as unknown as React.ReactNode);
      const opts: NormalizationOptions = {
        inspectionEnabled: true,
        debugMode: false,
        inspectionOptions,
      };
      assertThrows(
        () => ensureValidReactElement(el, opts),
        Error,
        "Invalid React child",
      );
    });

    it("should log final element check in debug mode", () => {
      const el = React.createElement("div", null, "test");
      const debugOpts: NormalizationOptions = {
        inspectionEnabled: false,
        debugMode: true,
        inspectionOptions,
      };
      const result = ensureValidReactElement(el, debugOpts);
      assertEquals(React.isValidElement(result), true);
    });
  });
});
