import { rendererLogger as logger } from "#veryfront/utils";
import * as BundledReact from "react";
import {
  getElementDebugInfo,
  getElementTypeName,
  isReactElement,
} from "../../element-validator/primitive-checks.ts";

const log = logger.component("ensure-valid-child");

/**
 * Returns the child unchanged if valid, or null if invalid.
 *
 * Uses cross-instance React element detection to handle elements created
 * by different React instances (bundled vs project React).
 */
export function ensureValidChild(
  child: BundledReact.ReactNode,
  // React parameter is kept for API compatibility but unused (uses isReactElement instead)
  _React?: unknown,
): BundledReact.ReactNode {
  if (isReactElement(child)) {
    log.debug("Valid React element", {
      type: getElementTypeName(child as BundledReact.ReactElement),
      isValidElement: true,
    });
    return child;
  }

  if (
    child == null ||
    typeof child === "string" ||
    typeof child === "number" ||
    Array.isArray(child)
  ) {
    log.debug("Valid primitive or array", { type: typeof child });
    return child;
  }

  if (typeof child !== "object") return null;

  const debugInfo = getElementDebugInfo(child);
  log.error("Invalid child: object is not a React element", {
    keys: Object.keys(child).slice(0, 10),
    hasSymbol: debugInfo.hasSymbol,
    symbolValue: debugInfo.symbolValue,
    type: debugInfo.type,
  });

  return null;
}
