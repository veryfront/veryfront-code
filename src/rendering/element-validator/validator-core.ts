/**
 * Validator Core
 *
 * Main ElementValidator class that orchestrates element validation and normalization.
 *
 * @module
 */

import * as React from "react";
import type { ValidationOptions } from "./types.ts";
import { deepInspectElement, type InspectionOptions } from "./element-inspector.ts";
import { ensureValidReactElement, type NormalizationOptions } from "./element-normalizer.ts";

/**
 * ElementValidator - Validates React element trees for rendering
 *
 * This class is critical for preventing React Error #31 (invalid object as React child).
 * It performs deep inspection of element trees to find and report invalid objects.
 *
 * @example
 * ```ts
 * const validator = new ElementValidator({ maxDepth: 20, debugMode: true });
 * const validElement = validator.ensureValidReactElement(pageElement, true);
 * ```
 */
export class ElementValidator {
  private readonly maxDepth: number;
  private readonly debugMode: boolean;

  constructor(options: ValidationOptions = {}) {
    this.maxDepth = options.maxDepth ?? 15;
    this.debugMode = options.debugMode ?? false;
  }

  /**
   * Deep inspection of React element tree to find invalid children
   *
   * Recursively walks the element tree and logs any invalid objects passed as children.
   *
   * @param element - The element to inspect
   * @param path - Current path in the tree (for debugging)
   * @param depth - Current depth in the tree
   * @throws Error if invalid object is found (would cause React Error #31)
   */
  deepInspectElement(element: unknown, path = "root", depth = 0): void {
    const inspectionOptions: InspectionOptions = {
      maxDepth: this.maxDepth,
      debugMode: this.debugMode,
    };

    deepInspectElement(element, path, depth, inspectionOptions);
  }

  /**
   * Validate and normalize a React element before rendering
   *
   * Ensures the element is a valid React element or converts it to one.
   *
   * @param pageElement - The element to validate
   * @param inspectionEnabled - Whether to perform deep inspection (expensive)
   * @returns Valid React element ready for rendering
   * @throws Error if deep inspection is enabled and invalid objects are found
   */
  ensureValidReactElement(
    pageElement: React.ReactNode,
    inspectionEnabled = false,
  ): React.ReactElement {
    const normalizationOptions: NormalizationOptions = {
      inspectionEnabled,
      debugMode: this.debugMode,
      inspectionOptions: {
        maxDepth: this.maxDepth,
        debugMode: this.debugMode,
      },
    };

    return ensureValidReactElement(pageElement, normalizationOptions);
  }
}
