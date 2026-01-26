import { deepInspectElement } from "./element-inspector.js";
import { ensureValidReactElement } from "./element-normalizer.js";
/**
 * Validates React element trees for rendering.
 * Critical for preventing React Error #31 (invalid object as React child).
 */
export class ElementValidator {
    maxDepth;
    debugMode;
    constructor(options = {}) {
        this.maxDepth = options.maxDepth ?? 15;
        this.debugMode = options.debugMode ?? false;
    }
    /** Recursively inspects element tree for invalid children that would cause React Error #31 */
    deepInspectElement(element, path = "root", depth = 0) {
        const inspectionOptions = {
            maxDepth: this.maxDepth,
            debugMode: this.debugMode,
        };
        deepInspectElement(element, path, depth, inspectionOptions);
    }
    /** Validates and normalizes a React element, optionally with deep inspection */
    ensureValidReactElement(pageElement, inspectionEnabled = false) {
        const inspectionOptions = {
            maxDepth: this.maxDepth,
            debugMode: this.debugMode,
        };
        const normalizationOptions = {
            inspectionEnabled,
            debugMode: this.debugMode,
            inspectionOptions,
        };
        return ensureValidReactElement(pageElement, normalizationOptions);
    }
}
