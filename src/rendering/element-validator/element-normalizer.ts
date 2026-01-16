import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { ensureError } from "@veryfront/errors/veryfront-error.ts";
import { normalizeChild } from "../utils/index.ts";
import { deepInspectElement, type InspectionOptions } from "./element-inspector.ts";
import { getElementTypeName, isReactElement } from "./primitive-checks.ts";

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
  const finalIsElement = isReactElement(finalChild);

  if (options.debugMode) {
    logFinalElementCheck(finalChild, finalIsElement);
  }

  if (finalIsElement) {
    return finalChild as React.ReactElement;
  }

  return React.createElement(React.Fragment, undefined, finalChild);
}

function performDeepInspection(
  element: React.ReactNode,
  inspectionOptions: InspectionOptions,
): void {
  logger.debug(
    "[VALIDATOR] Starting deep React element tree inspection before SSR",
  );

  try {
    deepInspectElement(element, "root", 0, inspectionOptions);
    logger.debug(
      "[VALIDATOR] Deep element tree inspection completed - no invalid objects found in props/children",
    );
  } catch (error) {
    const err = ensureError(error);
    logger.error("[VALIDATOR] Deep inspection failed", {
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }
}

function logFinalElementCheck(
  finalChild: unknown,
  finalIsElement: boolean,
): void {
  const hasChildrenKey = !!(
    finalChild &&
    typeof finalChild === "object" &&
    "children" in finalChild
  );

  const isElement = isReactElement(finalChild);
  const type = isElement ? getElementTypeName(finalChild as React.ReactElement) : typeof finalChild;

  logger.debug("Final element check before SSR", {
    finalIsElement,
    hasChildrenKey,
    type,
  });
}
