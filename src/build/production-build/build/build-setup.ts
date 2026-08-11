import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { handleErrorWithFallback } from "#veryfront/errors";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

export async function setupBuildDirectories(
  adapter: RuntimeAdapter,
  outputDir: string,
  dryRun: boolean,
): Promise<void> {
  logger.debug("Setting up build directories...");

  // A dry run touches nothing at all. Clearing the output directory first
  // deleted the project's previous build output — and anything else the
  // project kept in dist/ — while the CLI was printing "no files will be
  // written", leaving the developer with neither the old artifact nor a new
  // one.
  if (dryRun) {
    logger.debug("Build directories ready");
    return;
  }

  await handleErrorWithFallback(
    () => adapter.fs.remove(outputDir, { recursive: true }),
    undefined,
    logger,
  );

  const fs = createFileSystem();
  const dirs = [
    outputDir,
    join(outputDir, "_veryfront"),
    join(outputDir, "_veryfront/chunks"),
    join(outputDir, "_veryfront/data"),
    join(outputDir, "assets"),
  ];

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;

      if (code !== "EEXIST") throw error;
    }
  }

  logger.debug("Build directories ready");
}
