/**
 * Tailwind CSS v4 detection utilities
 *
 * Provides functions to detect Tailwind v4 files and auto-detect content paths.
 *
 * Security: Uses secure filesystem wrapper to prevent path traversal attacks
 *
 * @module
 */

import { join } from "std/path/mod.ts";
import { logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createSecureFs } from "@veryfront/security";

/**
 * Detects if a CSS file uses Tailwind v4
 *
 * Tailwind v4 uses @import "tailwindcss" instead of @tailwind directives.
 * This function checks for the v4 import syntax.
 *
 * @param filePath - Path to the CSS file to check
 * @param projectDir - Project root directory for path validation
 * @param adapter - Runtime adapter for filesystem access
 * @returns True if the file uses Tailwind v4 syntax
 *
 * @example
 * ```ts
 * const isTailwind = await isTailwindV4File('./styles/main.css', projectDir, adapter)
 * if (isTailwind) {
 *   console.log('Found Tailwind v4 file')
 * }
 * ```
 */
export async function isTailwindV4File(
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  // Create secure filesystem wrapper for build operations
  const secureFs = createSecureFs({
    baseDir: projectDir,
    adapter,
    context: "build",
    throwOnError: false, // Don't throw, just return false
  });

  try {
    // Use secure wrapper (replaces direct Deno access)
    const content = await secureFs.readFile(filePath);
    // Tailwind v4 uses @import "tailwindcss" or @import 'tailwindcss' (with optional path suffix)
    const tailwindV4ImportPattern = /@import\s+["']tailwindcss(?:\/[^"']*)?["']/;
    return tailwindV4ImportPattern.test(content);
  } catch (error) {
    logger.debug(`Failed to check file for Tailwind CSS: ${filePath}`, error);
    return false;
  }
}

/**
 * Auto-detects content paths for Tailwind scanning
 *
 * Scans common directories where component files might be located.
 * These paths are used by Tailwind to detect which utility classes to include.
 *
 * @param projectDir - Project root directory
 * @returns Array of glob patterns for content scanning
 *
 * @example
 * ```ts
 * const paths = autoDetectContentPaths('/path/to/project')
 * // Returns: [
 * //   '/path/to/project/app/**\/*.{js,ts,jsx,tsx,mdx}',
 * //   '/path/to/project/pages/**\/*.{js,ts,jsx,tsx,mdx}',
 * //   ...
 * // ]
 * ```
 */
export function autoDetectContentPaths(projectDir: string): string[] {
  return [
    join(projectDir, "app/**/*.{js,ts,jsx,tsx,mdx}"),
    join(projectDir, "pages/**/*.{js,ts,jsx,tsx,mdx}"),
    join(projectDir, "components/**/*.{js,ts,jsx,tsx,mdx}"),
    join(projectDir, "src/**/*.{js,ts,jsx,tsx,mdx}"),
  ];
}
