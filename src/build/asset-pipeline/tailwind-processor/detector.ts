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

export function isTailwindV4File(
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  return withSpan(
    "build.asset.isTailwindV4File",
    async (): Promise<boolean> => {
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

export function autoDetectContentPaths(projectDir: string): string[] {
  const patterns = [
    "app/**/*.{js,ts,jsx,tsx,mdx}",
    "pages/**/*.{js,ts,jsx,tsx,mdx}",
    "components/**/*.{js,ts,jsx,tsx,mdx}",
    "src/**/*.{js,ts,jsx,tsx,mdx}",
  ];

  return patterns.map((pattern) => join(projectDir, pattern));
}
