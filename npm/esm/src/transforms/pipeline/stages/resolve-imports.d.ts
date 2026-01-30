/**
 * Unified import resolution pipeline stage.
 *
 * Replaces: resolve-aliases, resolve-react, resolve-relative, resolve-bare
 * Uses the unified import rewriter for all import transformations.
 */
import { type TransformPlugin } from "../types.js";
/**
 * Unified import resolution plugin.
 *
 * This single plugin handles all import rewrites:
 * - React imports → esm.sh URLs
 * - @/ aliases → relative paths
 * - #veryfront/* → module server URLs (browser) or keep (SSR)
 * - Relative imports → resolved paths with .js extension
 * - Cross-project imports → module server URLs
 * - Bare npm imports → esm.sh URLs (browser) or import map (SSR)
 * - Vendor bundle → React from vendor.js (browser with vendor hash)
 */
export declare const resolveImportsPlugin: TransformPlugin;
export default resolveImportsPlugin;
//# sourceMappingURL=resolve-imports.d.ts.map