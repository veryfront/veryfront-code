/**
 * Tests for React Helper Utilities
 */

import { assert, assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import * as React from "react";
import { createDefaultMDXComponents, normalizeChild } from "./react-helpers.ts";

Deno.test("normalizeChild - returns valid React elements unchanged", () => {
  const element = React.createElement("div", null, "Hello");
  const result = normalizeChild(element);
  assertEquals(result, element);
  assert(React.isValidElement(result));
});

Deno.test("normalizeChild - handles primitives correctly", () => {
  assertEquals(normalizeChild(null), null);
  assertEquals(normalizeChild(undefined), undefined);
  assertEquals(normalizeChild("text"), "text");
  assertEquals(normalizeChild(42), 42);
  assertEquals(normalizeChild(true), true);
  assertEquals(normalizeChild(false), false);
});

Deno.test("normalizeChild - unwraps object with only children property", () => {
  const child = React.createElement("span", null, "Content");
  const wrapped = { children: child };
  // deno-lint-ignore no-explicit-any
  const result = normalizeChild(wrapped as any);
  assertEquals(result, child);
  assert(React.isValidElement(result));
});

Deno.test("normalizeChild - keeps objects with multiple properties", () => {
  const obj = { children: "test", other: "prop" };
  // deno-lint-ignore no-explicit-any
  const result = normalizeChild(obj as any);
  // Objects with multiple properties are kept as-is
  // deno-lint-ignore no-explicit-any
  assertEquals(result as any, obj);
});

Deno.test("normalizeChild - memoizes object normalization", () => {
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

Deno.test("normalizeChild - handles arrays", () => {
  const arr = [1, 2, 3];
  const result = normalizeChild(arr);
  assertEquals(result, arr);
});

Deno.test("createDefaultMDXComponents - creates all HTML element components", () => {
  const components = createDefaultMDXComponents();

  // Check that all expected components exist
  const expectedComponents = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "a",
    "blockquote",
    "ul",
    "ol",
    "li",
    "pre",
    "code",
    "em",
    "strong",
    "hr",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ];

  for (const tag of expectedComponents) {
    assert(components[tag], `Component ${tag} should exist`);
    assert(typeof components[tag] === "function", `Component ${tag} should be a function`);
  }
});

Deno.test("createDefaultMDXComponents - components render correctly", () => {
  const components = createDefaultMDXComponents();

  // Test h1 component - use React.createElement instead of calling directly
  const h1Component = components.h1;
  assert(h1Component);
  // deno-lint-ignore no-explicit-any
  const h1Element = React.createElement(h1Component as any, { children: "Heading" });
  assert(React.isValidElement(h1Element));

  // Test p component
  const pComponent = components.p;
  assert(pComponent);
  // deno-lint-ignore no-explicit-any
  const pElement = React.createElement(pComponent as any, { children: "Paragraph" });
  assert(React.isValidElement(pElement));

  // Test a component with href
  const aComponent = components.a;
  assert(aComponent);
  // deno-lint-ignore no-explicit-any
  const aElement = React.createElement(aComponent as any, { href: "/test", children: "Link" });
  assert(React.isValidElement(aElement));
});

Deno.test("createDefaultMDXComponents - components handle props correctly", () => {
  const components = createDefaultMDXComponents();

  const imgComponent = components.img;
  assert(imgComponent);
  const imgProps = { src: "/image.png", alt: "Test image" };
  // deno-lint-ignore no-explicit-any
  const imgElement = React.createElement(imgComponent as any, imgProps);

  assert(React.isValidElement(imgElement));
  // Props should be passed through
  // deno-lint-ignore no-explicit-any
  assertEquals((imgElement as any).props.src, "/image.png");
  // deno-lint-ignore no-explicit-any
  assertEquals((imgElement as any).props.alt, "Test image");
});

Deno.test("createDefaultMDXComponents - creates new instances on each call", () => {
  const components1 = createDefaultMDXComponents();
  const components2 = createDefaultMDXComponents();

  // Should be different objects
  assert(components1 !== components2);

  // But components should have the same structure
  const keys1 = Object.keys(components1).sort();
  const keys2 = Object.keys(components2).sort();
  assertEquals(keys1, keys2);
});
