
import * as React from "react";
import type { ValidationOptions } from "./types.ts";
import { deepInspectElement, type InspectionOptions } from "./element-inspector.ts";
import { ensureValidReactElement, type NormalizationOptions } from "./element-normalizer.ts";

export class ElementValidator {
  private readonly maxDepth: number;
  private readonly debugMode: boolean;

  constructor(options: ValidationOptions = {}) {
    this.maxDepth = options.maxDepth ?? 15;
    this.debugMode = options.debugMode ?? false;
  }

  deepInspectElement(element: unknown, path = "root", depth = 0): void {
    const inspectionOptions: InspectionOptions = {
      maxDepth: this.maxDepth,
      debugMode: this.debugMode,
    };

    deepInspectElement(element, path, depth, inspectionOptions);
  }

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
