import { rendererLogger as logger } from "@veryfront/utils";
import * as BundledReact from "react";
import {
  getElementDebugInfo,
  getElementTypeName,
} from "../../element-validator/primitive-checks.ts";

/**
 * Validates and returns a React-compatible child node.
 * Returns the child unchanged if valid, or null if the child is invalid.
 */
export function ensureValidChild(
  child: BundledReact.ReactNode,
  React: typeof BundledReact,
): BundledReact.ReactNode {
  if (React.isValidElement(child)) {
    logger.debug("[ensureValidChild] Valid React element", {
      type: getElementTypeName(child as BundledReact.ReactElement),
      isValidElement: true,
    });
    return child;
  }

  if (
    child === null ||
    child === undefined ||
    typeof child === "string" ||
    typeof child === "number" ||
    Array.isArray(child)
  ) {
    logger.debug("[ensureValidChild] Valid primitive or array", { type: typeof child });
    return child;
  }

  if (child && typeof child === "object") {
    const debugInfo = getElementDebugInfo(child);
    logger.error("[ensureValidChild] Invalid child: object is not a React element", {
      keys: Object.keys(child).slice(0, 10),
      hasSymbol: debugInfo.hasSymbol,
      symbolValue: debugInfo.symbolValue,
      type: debugInfo.type,
    });
  }

  return null;
}
