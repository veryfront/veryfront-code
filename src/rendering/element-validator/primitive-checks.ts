/**
 * Primitive Checks
 *
 * Utility functions for validating React primitives and elements.
 *
 * @module
 */

import * as React from "react";

/**
 * Check if a value is a valid React primitive
 * (null, undefined, string, number, boolean)
 */
export function isValidPrimitive(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Check if an object has a React symbol ($$typeof)
 * This indicates it might be a React element or similar structure
 */
export function hasReactSymbol(obj: Record<string, unknown>): boolean {
  return "$$typeof" in obj &&
    (typeof obj.$$typeof === "symbol" || typeof obj.$$typeof === "number");
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

/**
 * Cross-instance React element check
 *
 * Combines React.isValidElement with symbol-agnostic fallback
 * to handle elements created by different React instances.
 */
export function isReactElement(value: unknown): boolean {
  return React.isValidElement(value) || looksLikeReactElement(value);
}

/**
 * Symbol-agnostic check if a value looks like a React element.
 * This works across different React instances (bundled vs project)
 * where Symbol.for('react.element') may have different values.
 *
 * In npm bundle scenarios, the CLI bundles its own React with different
 * Symbol values than the project's React, causing React.isValidElement
 * from bundled React to return false for elements created by project React.
 */
export function looksLikeReactElement(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (!("$$typeof" in obj)) {
    return false;
  }

  const typeofSymbol = obj.$$typeof;
  if (typeof typeofSymbol !== "symbol" && typeof typeofSymbol !== "number") {
    return false;
  }

  // Check for React symbol by description (handles bundled vs project React)
  if (typeof typeofSymbol === "symbol") {
    const desc = typeofSymbol.description || String(typeofSymbol);
    if (REACT_SYMBOL_PREFIXES.some((prefix) => desc.includes(prefix))) {
      return true;
    }
  }

  // Fallback: check structural properties that all React elements have
  return "type" in obj && "props" in obj && "key" in obj;
}

/**
 * Get the display name of a React element type
 * Handles function components, class components, and intrinsic elements
 */
export function getElementTypeName(element: React.ReactElement): string {
  const type = element.type;

  if (typeof type === "function") {
    return (type as React.ComponentType<any>).name ||
      (type as React.ComponentType<any>).displayName || "<Anonymous>";
  }

  return String(type);
}

/**
 * Extract object keys for error reporting (limited to first 15)
 */
export function getObjectKeys(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") {
    return [];
  }
  return Object.keys(obj).slice(0, 15);
}

/**
 * Create a JSON sample of an object for error reporting
 * Limited to first 500 characters
 */
export function getObjectSample(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2).slice(0, 500);
  } catch {
    return "[Unable to stringify]";
  }
}

/**
 * Internal React element structure for debugging
 */
interface ReactElementInternal {
  $typeof?: symbol;
  type?: unknown;
  props?: unknown;
}

/**
 * Get detailed debug information about a React element
 * Used for error reporting and diagnostics
 */
export function getElementDebugInfo(child: unknown): {
  type: string;
  hasSymbol: boolean;
  symbolValue?: symbol;
  typeValue?: unknown;
} {
  const internal = child as ReactElementInternal;

  return {
    type: typeof (internal.type) === "function"
      ? (internal.type as { name?: string }).name || "AnonymousFunction"
      : String(internal.type),
    hasSymbol: "$typeof" in (child as object),
    symbolValue: internal.$typeof,
    typeValue: internal.type,
  };
}
