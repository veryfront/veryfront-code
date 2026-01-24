/**
 * Tailwind CSS v4 detection utilities.
 * Uses secure filesystem wrapper to prevent path traversal attacks.
 */

import { join } from "#veryfront/platform/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSecureFs } from "#veryfront/security";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const tailwindV4ImportPattern = /@import\s+["']tailwindcss(?:\/[^"']*)?["']/;

/** Detect if a CSS file uses Tailwind v4 (@import "tailwindcss" syntax) */
export function isTailwindV4File(
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  return withSpan(
    "build.asset.isTailwindV4File",
    async () => {
      const secureFs = createSecureFs({
        baseDir: projectDir,
        adapter,
        context: "build",
        throwOnError: false,
      });

      try {
        const content = await secureFs.readFile(filePath);
        return tailwindV4ImportPattern.test(content);
      } catch (error) {
        logger.debug(`Failed to check file for Tailwind CSS: ${filePath}`, error);
        return false;
      }
    },
    { "tailwind.filePath": filePath },
  );
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
