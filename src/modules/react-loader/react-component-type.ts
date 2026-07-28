import type * as React from "react";

const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const REACT_FORWARD_REF = Symbol.for("react.forward_ref");
const REACT_LAZY = Symbol.for("react.lazy");
const REACT_MEMO = Symbol.for("react.memo");

/**
 * Admit only callable or branded exotic React component types.
 *
 * The descriptor check deliberately avoids reading an attacker-controlled
 * `$$typeof` accessor. Opaque proxies and all other values fail closed.
 */
export function assertReactComponentType(
  value: unknown,
  source: string,
): React.ComponentType<Record<string, unknown>> {
  if (typeof value === "function") {
    return value as React.ComponentType<Record<string, unknown>>;
  }

  if (typeof value === "object" && value !== null) {
    try {
      const descriptor = objectGetOwnPropertyDescriptor(value, "$$typeof");
      const marker = descriptor && "value" in descriptor ? descriptor.value : undefined;
      if (
        marker === REACT_FORWARD_REF ||
        marker === REACT_LAZY ||
        marker === REACT_MEMO
      ) {
        return value as React.ComponentType<Record<string, unknown>>;
      }
    } catch {
      // Reject opaque proxies through the deterministic error below.
    }
  }

  throw new TypeError(`${source} did not export a React component`);
}
