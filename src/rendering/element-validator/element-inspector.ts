import * as React from "react";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import type { InvalidObjectDetails } from "./types.ts";
import {
  getElementTypeName,
  getObjectKeys,
  getObjectSample,
  hasReactSymbol,
  isReactElement,
  isValidPrimitive,
} from "./primitive-checks.ts";

const log = logger.component("deep-inspect");

export interface InspectionOptions {
  maxDepth: number;
  debugMode: boolean;
}

/** Recursively inspects element tree for invalid children that would cause React Error #31 */
export function deepInspectElement(
  element: unknown,
  path: string,
  depth: number,
  options: InspectionOptions,
  visited: WeakSet<object> = new WeakSet(),
): void {
  if (depth > options.maxDepth) {
    if (options.debugMode) logger.debug(`[DEEP INSPECT] Max depth reached at ${path}`);
    return;
  }

  if (element && typeof element === "object") {
    if (visited.has(element)) {
      if (options.debugMode) logger.debug(`[DEEP INSPECT] Cycle detected at ${path}, skipping`);
      return;
    }
    visited.add(element);
  }

  if (isReactElement(element)) {
    inspectReactElement(element as React.ReactElement, path, depth, options, visited);
    return;
  }

  if (isValidPrimitive(element)) {
    if (options.debugMode) {
      log.debug(`✓ Valid primitive at ${path}`, { type: typeof element, depth });
    }
    return;
  }

  if (Array.isArray(element)) {
    inspectArray(element, path, depth, options, visited);
    return;
  }

  if (element && typeof element === "object") {
    handleInvalidObject(element, path, depth);
  }
}

function inspectReactElement(
  element: React.ReactElement,
  path: string,
  depth: number,
  options: InspectionOptions,
  visited: WeakSet<object>,
): void {
  if (options.debugMode) {
    log.debug(`✓ Valid React element at ${path}`, {
      type: getElementTypeName(element),
      depth,
    });
  }

  const props = element.props;
  if (props && typeof props === "object") {
    inspectElementProps(props as Record<string, unknown>, path, depth, options, visited);
  }
}

function inspectElementProps(
  props: Record<string, unknown>,
  path: string,
  depth: number,
  options: InspectionOptions,
  visited: WeakSet<object>,
): void {
  for (const [key, value] of Object.entries(props)) {
    if (key === "__self" || key === "__source") continue;

    if (key === "children") {
      inspectChildren(value, path, depth, options, visited);
      continue;
    }

    if (isReactElement(value)) {
      deepInspectElement(value, `${path}.props.${key}`, depth + 1, options, visited);
      continue;
    }

    if (!Array.isArray(value)) continue;

    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (isReactElement(item)) {
        deepInspectElement(item, `${path}.props.${key}[${i}]`, depth + 1, options, visited);
      }
    }
  }
}

function inspectChildren(
  children: unknown,
  path: string,
  depth: number,
  options: InspectionOptions,
  visited: WeakSet<object>,
): void {
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      deepInspectElement(children[i], `${path}.children[${i}]`, depth + 1, options, visited);
    }
    return;
  }

  if (children != null) {
    deepInspectElement(children, `${path}.children`, depth + 1, options, visited);
  }
}

function inspectArray(
  arr: unknown[],
  path: string,
  depth: number,
  options: InspectionOptions,
  visited: WeakSet<object>,
): void {
  if (options.debugMode) {
    log.debug(`✓ Array at ${path}`, { length: arr.length, depth });
  }

  for (let i = 0; i < arr.length; i++) {
    deepInspectElement(arr[i], `${path}[${i}]`, depth + 1, options, visited);
  }
}

function handleInvalidObject(element: object, path: string, depth: number): void {
  const obj = element as Record<string, unknown>;
  const keys = getObjectKeys(element);

  if (hasReactSymbol(obj)) {
    log.debug(`? Skipping object with React symbol at ${path}`, {
      keys,
      symbolValue: obj.$$typeof,
    });
    return;
  }

  const constructorName = (element as { constructor?: { name?: string } }).constructor?.name;

  const errorDetails: InvalidObjectDetails = {
    path,
    depth,
    keys,
    hasSymbol: "$$typeof" in obj,
    symbolValue: obj.$$typeof,
    type: obj.type,
    constructor: constructorName,
    sample: getObjectSample(element),
  };

  logger.error(
    `[DEEP INSPECT] ❌ INVALID OBJECT at ${path} - This will cause React Error #31!`,
    errorDetails,
  );

  throw toError(
    createError({
      type: "config",
      message: `Invalid React child found at ${path}! ` +
        `This object cannot be rendered as a React child. ` +
        `Keys: [${keys.join(", ")}]. ` +
        `Type: ${obj.type || "unknown"}. ` +
        `Constructor: ${constructorName || "unknown"}.`,
    }),
  );
}
