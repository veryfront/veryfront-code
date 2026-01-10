import * as React from "react";
import type { ValidationOptions } from "./types.ts";
import { deepInspectElement, type InspectionOptions } from "./element-inspector.ts";
import { ensureValidReactElement, type NormalizationOptions } from "./element-normalizer.ts";

/**
 * Validates React element trees for rendering.
 * Critical for preventing React Error #31 (invalid object as React child).
 */
export class ElementValidator {
  private readonly maxDepth: number;
  private readonly debugMode: boolean;

  constructor(options: ValidationOptions = {}) {
    this.maxDepth = options.maxDepth ?? 15;
    this.debugMode = options.debugMode ?? false;
  }

  /** Recursively inspects element tree for invalid children that would cause React Error #31 */
  deepInspectElement(element: unknown, path = "root", depth = 0): void {
    const inspectionOptions: InspectionOptions = {
      maxDepth: this.maxDepth,
      debugMode: this.debugMode,
    };

    deepInspectElement(element, path, depth, inspectionOptions);
  }

  /** Validates and normalizes a React element, optionally with deep inspection */
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
