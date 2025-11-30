/**
 * Element Inspector
 *
 * Deep inspection logic for React element trees.
 * Recursively walks element trees to detect invalid objects that would cause React Error #31.
 *
 * @module
 */

import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import type { InvalidObjectDetails } from "./types.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import {
  getElementTypeName,
  getObjectKeys,
  getObjectSample,
  hasReactSymbol,
  isValidPrimitive,
  looksLikeReactElement,
} from "./primitive-checks.ts";

/**
 * Options for element inspection
 */
export interface InspectionOptions {
  maxDepth: number;
  debugMode: boolean;
}

/**
 * Deep inspection of React element tree to find invalid children
 *
 * Recursively walks the element tree and logs any invalid objects passed as children.
 * This is critical for preventing React Error #31 (invalid object as React child).
 *
 * @param element - The element to inspect
 * @param path - Current path in the tree (for debugging)
 * @param depth - Current depth in the tree
 * @param options - Inspection options
 * @throws Error if invalid object is found (would cause React Error #31)
 */
export function deepInspectElement(
  element: unknown,
  path: string,
  depth: number,
  options: InspectionOptions,
): void {
  // Prevent infinite recursion
  if (depth > options.maxDepth) {
    if (options.debugMode) {
      logger.debug(`[DEEP INSPECT] Max depth reached at ${path}`);
    }
    return;
  }

  // Valid React elements (use symbol-agnostic check for cross-instance compatibility)
  // This handles elements created by project React when running in bundled CLI
  if (React.isValidElement(element) || looksLikeReactElement(element)) {
    inspectReactElement(element as React.ReactElement, path, depth, options);
    return;
  }

  // Valid primitives
  if (isValidPrimitive(element)) {
    if (options.debugMode) {
      logger.debug(`[DEEP INSPECT] ✓ Valid primitive at ${path}`, {
        type: typeof element,
        depth,
      });
    }
    return;
  }

  // Arrays
  if (Array.isArray(element)) {
    inspectArray(element, path, depth, options);
    return;
  }

  // Invalid object - this is what causes React Error #31
  if (element && typeof element === "object") {
    handleInvalidObject(element, path, depth);
  }
}

/**
 * Inspect a React element and its props/children
 */
function inspectReactElement(
  element: React.ReactElement,
  path: string,
  depth: number,
  options: InspectionOptions,
): void {
  const elementType = getElementTypeName(element);

  if (options.debugMode) {
    logger.debug(`[DEEP INSPECT] ✓ Valid React element at ${path}`, {
      type: elementType,
      depth,
    });
  }

  // Recursively inspect props
  const props = (element as React.ReactElement).props;
  if (props && typeof props === "object") {
    inspectElementProps(props as Record<string, unknown>, path, depth, options);
  }
}

/**
 * Inspect element props for nested elements
 */
function inspectElementProps(
  props: Record<string, unknown>,
  path: string,
  depth: number,
  options: InspectionOptions,
): void {
  for (const key of Object.keys(props)) {
    const value = props[key];

    // Skip special props that don't need inspection
    if (key === "__self" || key === "__source") continue;

    if (key === "children") {
      // Children prop - inspect each child
      inspectChildren(value, path, depth, options);
    } else if (React.isValidElement(value) || looksLikeReactElement(value)) {
      // Element prop (use symbol-agnostic check for cross-instance compatibility)
      deepInspectElement(value, `${path}.props.${key}`, depth + 1, options);
    } else if (Array.isArray(value)) {
      // Array prop - check for elements (use symbol-agnostic check)
      value.forEach((item, i) => {
        if (React.isValidElement(item) || looksLikeReactElement(item)) {
          deepInspectElement(
            item,
            `${path}.props.${key}[${i}]`,
            depth + 1,
            options,
          );
        }
      });
    }
  }
}

/**
 * Inspect children prop (can be single child or array)
 */
function inspectChildren(
  children: unknown,
  path: string,
  depth: number,
  options: InspectionOptions,
): void {
  if (Array.isArray(children)) {
    children.forEach((child, i) => {
      deepInspectElement(child, `${path}.children[${i}]`, depth + 1, options);
    });
  } else if (children !== null && children !== undefined) {
    deepInspectElement(children, `${path}.children`, depth + 1, options);
  }
}

/**
 * Inspect an array of elements
 */
function inspectArray(
  arr: unknown[],
  path: string,
  depth: number,
  options: InspectionOptions,
): void {
  if (options.debugMode) {
    logger.debug(`[DEEP INSPECT] ✓ Array at ${path}`, {
      length: arr.length,
      depth,
    });
  }
  arr.forEach((item, i) => {
    deepInspectElement(item, `${path}[${i}]`, depth + 1, options);
  });
}

/**
 * Handle invalid object that would cause React Error #31
 */
function handleInvalidObject(
  element: unknown,
  path: string,
  depth: number,
): void {
  const obj = element as Record<string, unknown>;
  const keys = getObjectKeys(element);

  // Double-check it's not a React element (should have been caught above)
  if (hasReactSymbol(obj)) {
    // This is likely a React element that wasn't caught by React.isValidElement
    // This shouldn't happen, but if it does, log and skip rather than throw
    logger.debug(`[DEEP INSPECT] ? Skipping object with React symbol at ${path}`, {
      keys,
      symbolValue: obj.$$typeof,
    });
    return;
  }

  const errorDetails: InvalidObjectDetails = {
    path,
    depth,
    keys,
    hasSymbol: "$$typeof" in obj,
    symbolValue: obj.$$typeof,
    type: obj.type,
    constructor: (element as { constructor?: { name?: string } }).constructor?.name,
    sample: getObjectSample(element),
  };

  logger.error(
    `[DEEP INSPECT] ❌ INVALID OBJECT at ${path} - This will cause React Error #31!`,
    errorDetails,
  );

  // Throw error to stop rendering and provide clear debugging info
  throw toError(createError({
    type: "config",
    message: `Invalid React child found at ${path}! ` +
      `This object cannot be rendered as a React child. ` +
      `Keys: [${keys.join(", ")}]. ` +
      `Type: ${obj.type || "unknown"}. ` +
      `Constructor: ${
        (element as { constructor?: { name?: string } }).constructor?.name || "unknown"
      }.`,
  }));
}
