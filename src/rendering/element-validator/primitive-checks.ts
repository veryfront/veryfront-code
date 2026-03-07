import * as React from "react";

export function isValidPrimitive(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function hasReactSymbol(obj: Record<string, unknown>): boolean {
  const symbolValue = obj.$$typeof;
  return (
    "$$typeof" in obj &&
    (typeof symbolValue === "symbol" || typeof symbolValue === "number")
  );
}

const REACT_SYMBOL_PREFIXES = [
  "react.element",
  "react.fragment",
  "react.portal",
  "react.forward_ref",
  "react.memo",
  "react.lazy",
  "react.suspense",
  "react.context",
];

export function isReactElement(value: unknown): boolean {
  return React.isValidElement(value) || looksLikeReactElement(value);
}

export function looksLikeReactElement(value: unknown): boolean {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const obj = value as Record<string, unknown>;
  const typeofSymbol = obj.$$typeof;

  if (typeof typeofSymbol !== "symbol" && typeof typeofSymbol !== "number") {
    return false;
  }

  // Check for React symbol by description (handles bundled vs project React)
  if (typeof typeofSymbol === "symbol") {
    const desc = typeofSymbol.description ?? String(typeofSymbol);
    if (REACT_SYMBOL_PREFIXES.some((prefix) => desc.includes(prefix))) {
      return true;
    }
  }

  // Fallback: check structural properties that all React elements have
  return "type" in obj && "props" in obj && "key" in obj;
}

export function getElementTypeName(element: React.ReactElement): string {
  const { type } = element;

  if (typeof type === "function") {
    const componentType = type as React.ComponentType<unknown>;
    return type.name || componentType.displayName || "<Anonymous>";
  }

  return String(type);
}

export function getObjectKeys(obj: unknown): string[] {
  if (obj == null || typeof obj !== "object") {
    return [];
  }

  return Object.keys(obj).slice(0, 15);
}

export function getObjectSample(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2).slice(0, 500);
  } catch (_) {
    /* expected: object may contain circular references or non-serializable values */
    return "[Unable to stringify]";
  }
}

interface ReactElementInternal {
  $typeof?: symbol;
  type?: unknown;
  props?: unknown;
}

export function getElementDebugInfo(child: unknown): {
  type: string;
  hasSymbol: boolean;
  symbolValue?: symbol;
  typeValue?: unknown;
} {
  if (child == null || typeof child !== "object") {
    return {
      type: "undefined",
      hasSymbol: false,
      symbolValue: undefined,
      typeValue: undefined,
    };
  }

  const internal = child as ReactElementInternal;

  let type: string;
  if (typeof internal.type === "function") {
    type = (internal.type as { name?: string }).name || "AnonymousFunction";
  } else {
    type = String(internal.type);
  }

  return {
    type,
    hasSymbol: "$typeof" in child,
    symbolValue: internal.$typeof,
    typeValue: internal.type,
  };
}
