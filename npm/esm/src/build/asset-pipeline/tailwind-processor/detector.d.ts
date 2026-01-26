/**
 * Tailwind CSS v4 detection utilities.
 * Uses secure filesystem wrapper to prevent path traversal attacks.
 */
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
/** Detect if a CSS file uses Tailwind v4 (@import "tailwindcss" syntax) */
export declare function isTailwindV4File(filePath: string, projectDir: string, adapter: RuntimeAdapter): Promise<boolean>;
/** Auto-detect content paths for Tailwind class scanning */
export declare function autoDetectContentPaths(projectDir: string): string[];
//# sourceMappingURL=detector.d.ts.map