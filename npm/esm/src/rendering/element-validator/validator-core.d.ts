import * as React from "react";
import type { ValidationOptions } from "./types.js";
/**
 * Validates React element trees for rendering.
 * Critical for preventing React Error #31 (invalid object as React child).
 */
export declare class ElementValidator {
    private readonly maxDepth;
    private readonly debugMode;
    constructor(options?: ValidationOptions);
    /** Recursively inspects element tree for invalid children that would cause React Error #31 */
    deepInspectElement(element: unknown, path?: string, depth?: number): void;
    /** Validates and normalizes a React element, optionally with deep inspection */
    ensureValidReactElement(pageElement: React.ReactNode, inspectionEnabled?: boolean): React.ReactElement;
}
//# sourceMappingURL=validator-core.d.ts.map