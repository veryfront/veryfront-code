import { rendererLogger as logger } from "#veryfront/utils";
import * as BundledReact from "react";
import {
  getElementDebugInfo,
  getElementTypeName,
  isReactElement,
} from "../../element-validator/primitive-checks.ts";

/**
 * Returns the child unchanged if valid, or null if invalid.
 *
 * Uses cross-instance React element detection to handle elements created
 * by different React instances (bundled vs project React).
 */
export function ensureValidChild(
  child: BundledReact.ReactNode,
  _React: typeof BundledReact,
): BundledReact.ReactNode {
  // Use cross-instance check that handles elements from different React versions
  if (isReactElement(child)) {
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
