/**
 * Tailwind CSS v4 detection utilities.
 * Uses secure filesystem wrapper to prevent path traversal attacks.
 */

import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSecureFs } from "#veryfront/security";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const tailwindV4ImportPattern = /^@import\s+(?:url\(\s*)?(["'])tailwindcss(?:\/[^"']*)?\1\s*\)?/i;

export function hasTailwindV4Import(content: string): boolean {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let blockDepth = 0;

  for (let index = 0; index < content.length; index++) {
    const current = content[index];
    if (current === undefined) continue;
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "/" && content[index + 1] === "*") {
      const end = content.indexOf("*/", index + 2);
      if (end === -1) throw new SyntaxError("Unterminated CSS comment");
      index = end + 1;
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }
    if (current === "{") blockDepth++;
    else if (current === "}") blockDepth--;
    else if (blockDepth === 0 && current === "@") {
      if (tailwindV4ImportPattern.test(content.slice(index))) return true;
    }
  }
  if (quote) throw new SyntaxError("Unterminated CSS string");
  if (blockDepth !== 0) throw new SyntaxError("Unbalanced CSS blocks");
  return false;
}

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
        throwOnError: true,
        validationOptions: { followSymlinks: false },
      });

      const content = await secureFs.readFile(filePath);
      return hasTailwindV4Import(content);
    },
    {},
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
