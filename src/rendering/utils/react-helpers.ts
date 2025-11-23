/**
 * React Helper Utilities
 * Pure utility functions for working with React elements and components
 */

import * as React from "react";
import type { MDXComponents } from "@veryfront/types";

/**
 * Normalize a child element by unwrapping simple objects with only a children property
 *
 * This is a memoized utility that handles React children normalization.
 * It uses a WeakMap cache for object memoization to avoid repeated processing.
 *
 * @param child - The React child node to normalize
 * @returns The normalized React child node
 *
 * @example
 * ```ts
 * const child = { children: <div>Hello</div> };
 * const normalized = normalizeChild(child);
 * // Returns: <div>Hello</div>
 * ```
 */
export const normalizeChild = (() => {
  const cache = new WeakMap<object, React.ReactNode>();

  return (child: React.ReactNode): React.ReactNode => {
    if (React.isValidElement(child)) {
      return child;
    }

    // Memoize object normalization
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const cached = cache.get(child);
      if (cached !== undefined) {
        return cached;
      }

      const keys = Object.keys(child);
      const result = keys.length === 1 && keys[0] === "children"
        ? (child as unknown as { children: React.ReactNode }).children
        : child;

      cache.set(child, result);
      return result;
    }

    return child;
  };
})();

/**
 * Create default MDX components for HTML elements
 *
 * This utility creates a set of default component mappings for MDX,
 * mapping common HTML elements to React components.
 *
 * @returns An object mapping MDX component names to React components
 *
 * @example
 * ```ts
 * const components = createDefaultMDXComponents();
 * // Returns: { h1: Component, h2: Component, p: Component, ... }
 * ```
 */
export function createDefaultMDXComponents(): MDXComponents {
  const createComponent = (tag: string): React.ComponentType<unknown> => {
    return ((props: unknown) =>
      React.createElement(tag, props as Record<string, unknown>)) as React.ComponentType<unknown>;
  };

  return {
    h1: createComponent("h1"),
    h2: createComponent("h2"),
    h3: createComponent("h3"),
    h4: createComponent("h4"),
    h5: createComponent("h5"),
    h6: createComponent("h6"),
    p: createComponent("p"),
    a: createComponent("a"),
    blockquote: createComponent("blockquote"),
    ul: createComponent("ul"),
    ol: createComponent("ol"),
    li: createComponent("li"),
    pre: createComponent("pre"),
    code: createComponent("code"),
    em: createComponent("em"),
    strong: createComponent("strong"),
    hr: createComponent("hr"),
    img: createComponent("img"),
    table: createComponent("table"),
    thead: createComponent("thead"),
    tbody: createComponent("tbody"),
    tr: createComponent("tr"),
    th: createComponent("th"),
    td: createComponent("td"),
  };
}
