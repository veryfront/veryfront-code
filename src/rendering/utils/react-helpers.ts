import * as React from "react";
import type { MDXComponents } from "@veryfront/types";

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

export function createDefaultMDXComponents(): MDXComponents {
  return {};
}
