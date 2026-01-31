import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { handleErrorWithFallback } from "#veryfront/errors/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

export async function setupBuildDirectories(
  adapter: RuntimeAdapter,
  outputDir: string,
  dryRun: boolean,
): Promise<void> {
  logger.info("Setting up build directories...");

  await handleErrorWithFallback(
    () => adapter.fs.remove(outputDir, { recursive: true }),
    undefined,
    logger,
  );

  if (dryRun) {
    logger.info("Build directories ready");
    return;
  }

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

  logger.info("Build directories ready");
}
