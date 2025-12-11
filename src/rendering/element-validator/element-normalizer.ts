
import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { normalizeChild } from "../utils/index.ts";
import { deepInspectElement, type InspectionOptions } from "./element-inspector.ts";
import { getElementTypeName, looksLikeReactElement } from "./primitive-checks.ts";

export interface NormalizationOptions {
  inspectionEnabled?: boolean;

  debugMode?: boolean;

  inspectionOptions: InspectionOptions;
}

export function ensureValidReactElement(
  pageElement: React.ReactNode,
  options: NormalizationOptions,
): React.ReactElement {
  if (options.inspectionEnabled) {
    performDeepInspection(pageElement, options.inspectionOptions);
  }

  const finalChild = normalizeChild(pageElement);

  const finalIsElement = React.isValidElement(finalChild) || looksLikeReactElement(finalChild);

  if (options.debugMode) {
    logFinalElementCheck(finalChild, finalIsElement);
  }

  // Note: We pass it through directly even if created by project React,
  // because the rendering pipeline (SSR) will use project's React DOM
  if (finalIsElement) {
    return finalChild as React.ReactElement;
  }

  return React.createElement(React.Fragment, undefined, finalChild);
}

function performDeepInspection(
  element: React.ReactNode,
  inspectionOptions: InspectionOptions,
): void {
  logger.info(
    "[VALIDATOR] Starting deep React element tree inspection before SSR",
  );

  try {
    deepInspectElement(element, "root", 0, inspectionOptions);
    logger.info(
      "[VALIDATOR] ✓ Deep element tree inspection completed - no invalid objects found in props/children",
    );
  } catch (error) {
    const err = error as Error;
    logger.error("[VALIDATOR] ❌ Deep inspection failed", {
      error: err.message,
      stack: err.stack,
    });
    throw error;
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

  const isElement = React.isValidElement(finalChild) || looksLikeReactElement(finalChild);
  const type = isElement ? getElementTypeName(finalChild as React.ReactElement) : typeof finalChild;

  logger.info("Final element check before SSR", {
    finalIsElement,
    hasChildrenKey,
    type,
  });
}
