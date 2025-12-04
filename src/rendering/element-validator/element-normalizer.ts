/**
 * Element Normalizer
 *
 * Validates and normalizes React elements before rendering.
 * Ensures elements are valid React elements or converts them to valid ones.
 *
 * @module
 */

import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { normalizeChild } from "../utils/index.ts";
import { deepInspectElement, type InspectionOptions } from "./element-inspector.ts";
import { getElementTypeName, looksLikeReactElement } from "./primitive-checks.ts";

/**
 * Options for element validation and normalization
 */
export interface NormalizationOptions {
  /** Whether to perform deep inspection (expensive) */
  inspectionEnabled?: boolean;

  /** Debug mode for verbose logging */
  debugMode?: boolean;

  /** Inspection configuration */
  inspectionOptions: InspectionOptions;
}

/**
 * Validate and normalize a React element before rendering
 *
 * Ensures the element is a valid React element or converts it to one.
 * Optionally performs deep inspection to find invalid children.
 *
 * @param pageElement - The element to validate
 * @param options - Normalization options
 * @returns Valid React element ready for rendering
 * @throws Error if deep inspection is enabled and invalid objects are found
 */
export function ensureValidReactElement(
  pageElement: React.ReactNode,
  options: NormalizationOptions,
): React.ReactElement {
  // Perform deep inspection if enabled
  if (options.inspectionEnabled) {
    performDeepInspection(pageElement, options.inspectionOptions);
  }

  // Normalize the child
  const finalChild = normalizeChild(pageElement);

  // Use symbol-agnostic check for cross-instance compatibility
  // This handles elements created by project React when running in bundled CLI
  const finalIsElement = React.isValidElement(finalChild) || looksLikeReactElement(finalChild);

  // Log final element check if debug mode is enabled
  if (options.debugMode) {
    logFinalElementCheck(finalChild, finalIsElement);
  }

  // Return element directly if it looks like a valid React element
  // Note: We pass it through directly even if created by project React,
  // because the rendering pipeline (SSR) will use project's React DOM
  if (finalIsElement) {
    return finalChild as React.ReactElement;
  }

  // Wrap non-elements in Fragment
  return React.createElement(React.Fragment, undefined, finalChild);
}

/**
 * Perform deep inspection of element tree
 */
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
    // Re-throw to prevent rendering invalid elements
    throw error;
  }
}

/**
 * Log final element check for debugging
 */
function logFinalElementCheck(
  finalChild: unknown,
  finalIsElement: boolean,
): void {
  const hasChildrenKey = !!(
    finalChild &&
    typeof finalChild === "object" &&
    "children" in finalChild
  );

  // Use symbol-agnostic check for cross-instance compatibility
  const isElement = React.isValidElement(finalChild) || looksLikeReactElement(finalChild);
  const type = isElement ? getElementTypeName(finalChild as React.ReactElement) : typeof finalChild;

  logger.info("Final element check before SSR", {
    finalIsElement,
    hasChildrenKey,
    type,
  });
}
