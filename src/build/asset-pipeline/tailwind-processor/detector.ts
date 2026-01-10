/**
 * Tailwind CSS v4 detection utilities.
 * Uses secure filesystem wrapper to prevent path traversal attacks.
 */

import { join } from "std/path/mod.ts";
import { logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createSecureFs } from "@veryfront/security";

/** Detect if a CSS file uses Tailwind v4 (@import "tailwindcss" syntax) */
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

/** Auto-detect content paths for Tailwind class scanning */
export function autoDetectContentPaths(projectDir: string): string[] {
  return [
    join(projectDir, "app/**/*.{js,ts,jsx,tsx,mdx}"),
    join(projectDir, "pages/**/*.{js,ts,jsx,tsx,mdx}"),
    join(projectDir, "components/**/*.{js,ts,jsx,tsx,mdx}"),
    join(projectDir, "src/**/*.{js,ts,jsx,tsx,mdx}"),
  ];
}
