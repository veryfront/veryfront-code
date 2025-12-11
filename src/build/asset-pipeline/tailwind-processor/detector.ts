
import { join } from "std/path/mod.ts";
import { logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createSecureFs } from "@veryfront/security";

export async function isTailwindV4File(
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  const secureFs = createSecureFs({
    baseDir: projectDir,
    adapter,
    context: "build",
    throwOnError: false,
  });

  try {
    const content = await secureFs.readFile(filePath);
    return /@import\s+["']tailwindcss["']/.test(content) ||
      /@import\s+["']tailwindcss\//.test(content);
  } catch (error) {
    logger.debug(`Failed to check file for Tailwind CSS: ${filePath}`, error);
    return false;
  }
}

export function autoDetectContentPaths(projectDir: string): string[] {
  return [
    join(projectDir, "app *.{js,ts,jsx,tsx,mdx}"),
    join(projectDir, "pages *.{js,ts,jsx,tsx,mdx}"),
    join(projectDir, "components *.{js,ts,jsx,tsx,mdx}"),
    join(projectDir, "src *.{js,ts,jsx,tsx,mdx}"),
  ];
}
