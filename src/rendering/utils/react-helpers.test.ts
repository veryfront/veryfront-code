import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
    const wrapped = { children: child } as React.ReactNode;
    const result = normalizeChild(wrapped);

    assertEquals(result, child);
    assert(React.isValidElement(result));
  });

  it("keeps objects with multiple properties", () => {
    const obj = { children: "test", other: "prop" } as React.ReactNode;
    const result = normalizeChild(obj);

    assertEquals(result, obj);
  });

  it("normalizes the same wrapper consistently", () => {
    const child = React.createElement("span", null, "Content");
    const wrapped = { children: child } as React.ReactNode;

    const result1 = normalizeChild(wrapped);
    const result2 = normalizeChild(wrapped);

    assertEquals(result1, result2);
    assertEquals(result1, child);
  });

  it("does not retain stale children from mutable wrapper objects", () => {
    const wrapped = { children: "first" } as React.ReactNode;
    assertEquals(normalizeChild(wrapped), "first");

    (wrapped as unknown as { children: React.ReactNode }).children = "second";
    assertEquals(normalizeChild(wrapped), "second");
  });

  it("does not invoke accessor-backed wrappers or React markers", () => {
    let reads = 0;
    const wrapped = Object.defineProperties({}, {
      children: {
        enumerable: true,
        get() {
          reads++;
          throw new Error("must not execute");
        },
      },
      $$typeof: {
        get() {
          reads++;
          throw new Error("must not execute");
        },
      },
    }) as React.ReactNode;

    assertEquals(normalizeChild(wrapped), wrapped);
    assertEquals(reads, 0);
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

    assert(components1 !== components2);
    assertEquals(Object.keys(components1), Object.keys(components2));
  });
});
