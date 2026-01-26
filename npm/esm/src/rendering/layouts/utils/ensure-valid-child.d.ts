import * as BundledReact from "react";
/**
 * Returns the child unchanged if valid, or null if invalid.
 *
 * Uses cross-instance React element detection to handle elements created
 * by different React instances (bundled vs project React).
 */
export declare function ensureValidChild(child: BundledReact.ReactNode, _React?: unknown): BundledReact.ReactNode;
//# sourceMappingURL=ensure-valid-child.d.ts.map