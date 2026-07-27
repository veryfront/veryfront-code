import type * as React from "react";

const REACT_EXOTIC_COMPONENT_TYPES = new Set([
  Symbol.for("react.forward_ref"),
  Symbol.for("react.lazy"),
  Symbol.for("react.memo"),
]);

export function assertReactComponentType(
  value: unknown,
  source: string,
): React.ComponentType<Record<string, unknown>> {
  if (typeof value === "function") {
    return value as React.ComponentType<Record<string, unknown>>;
  }

  if (typeof value === "object" && value !== null) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, "$$typeof");
      if (
        descriptor &&
        Object.hasOwn(descriptor, "value") &&
        typeof descriptor.value === "symbol" &&
        REACT_EXOTIC_COMPONENT_TYPES.has(descriptor.value)
      ) {
        return value as React.ComponentType<Record<string, unknown>>;
      }
    } catch {
      // Fall through to the deterministic error below without invoking proxy
      // accessors or exposing arbitrary values.
    }
  }

  throw new TypeError(`${source} did not export a React component`);
}
