/**
 * Tests for React Helper Utilities
 */

import { assert, assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import * as React from "react";
import { createDefaultMDXComponents, normalizeChild } from "./react-helpers.ts";

describe("normalizeChild", () => {
  it("returns valid React elements unchanged", () => {
    const element = React.createElement("div", null, "Hello");
    const result = normalizeChild(element);
    assertEquals(result, element);
    assert(React.isValidElement(result));
  });

  it("handles primitives correctly", () => {
    assertEquals(normalizeChild(null), null);
    assertEquals(normalizeChild(undefined), undefined);
    assertEquals(normalizeChild("text"), "text");
    assertEquals(normalizeChild(42), 42);
    assertEquals(normalizeChild(true), true);
    assertEquals(normalizeChild(false), false);
  });

  it("unwraps object with only children property", () => {
    const child = React.createElement("span", null, "Content");
    const wrapped = { children: child };
    // deno-lint-ignore no-explicit-any
    const result = normalizeChild(wrapped as any);
    assertEquals(result, child);
    assert(React.isValidElement(result));
  });

  it("keeps objects with multiple properties", () => {
    const obj = { children: "test", other: "prop" };
    // deno-lint-ignore no-explicit-any
    const result = normalizeChild(obj as any);
    // Objects with multiple properties are kept as-is
    // deno-lint-ignore no-explicit-any
    assertEquals(result as any, obj);
  });

  it("memoizes object normalization", () => {
    const child = React.createElement("span", null, "Content");
    const wrapped = { children: child };

    // First call
    // deno-lint-ignore no-explicit-any
    const result1 = normalizeChild(wrapped as any);
    // Second call should return cached result
    // deno-lint-ignore no-explicit-any
    const result2 = normalizeChild(wrapped as any);

    assertEquals(result1, result2);
    assertEquals(result1, child);
  });

  it("handles arrays", () => {
    const arr = [1, 2, 3];
    const result = normalizeChild(arr);
    assertEquals(result, arr);
  });
});

describe("createDefaultMDXComponents", () => {
  it("returns empty object for npm package compatibility", () => {
    const components = createDefaultMDXComponents();

    // Should return empty object - MDX handles HTML elements natively
    // This avoids React instance mismatch when CLI's bundled React creates elements
    // that are then rendered by the project's react-dom/server
    assertEquals(Object.keys(components).length, 0);
    assertEquals(components, {});
  });

  it("creates new object instances on each call", () => {
    const components1 = createDefaultMDXComponents();
    const components2 = createDefaultMDXComponents();

    // Should be different object instances even though both are empty
    assert(components1 !== components2);
    assertEquals(Object.keys(components1), Object.keys(components2));
  });
});
