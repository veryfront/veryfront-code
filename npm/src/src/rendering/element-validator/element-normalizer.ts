import * as React from "react";
import { rendererLogger as logger } from "../../utils/index.js";
import { ensureError } from "../../errors/veryfront-error.js";
import { normalizeChild } from "../utils/index.js";
import { deepInspectElement, type InspectionOptions } from "./element-inspector.js";
import { getElementTypeName, isReactElement } from "./primitive-checks.js";

export interface NormalizationOptions {
  inspectionEnabled?: boolean;
  debugMode?: boolean;
  inspectionOptions: InspectionOptions;
}

/** Validates and normalizes a React element before rendering */
export function ensureValidReactElement(
  pageElement: React.ReactNode,
  options: NormalizationOptions,
): React.ReactElement {
  if (options.inspectionEnabled) {
    performDeepInspection(pageElement, options.inspectionOptions);
  }

  const finalChild = normalizeChild(pageElement);

  if (options.debugMode) {
    logFinalElementCheck(finalChild);
  }

  if (isReactElement(finalChild)) {
    return finalChild as React.ReactElement;
  }

  return React.createElement(React.Fragment, undefined, finalChild);
}

function performDeepInspection(
  element: React.ReactNode,
  inspectionOptions: InspectionOptions,
): void {
  logger.debug("[VALIDATOR] Starting deep React element tree inspection before SSR");

  try {
    deepInspectElement(element, "root", 0, inspectionOptions);
    logger.debug(
      "[VALIDATOR] Deep element tree inspection completed - no invalid objects found in props/children",
    );
  } catch (error) {
    const normalizedError = ensureError(error);
    logger.error("[VALIDATOR] Deep inspection failed", {
      error: normalizedError.message,
      stack: normalizedError.stack,
    });
    throw error;
  }
}

function logFinalElementCheck(finalChild: unknown): void {
  const finalIsElement = isReactElement(finalChild);
  const hasChildrenKey = finalChild != null && typeof finalChild === "object" &&
    "children" in finalChild;

  const type = finalIsElement
    ? getElementTypeName(finalChild as React.ReactElement)
    : typeof finalChild;

  logger.debug("Final element check before SSR", {
    finalIsElement,
    hasChildrenKey,
    type,
  });
}
