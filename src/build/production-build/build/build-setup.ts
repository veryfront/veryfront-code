import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

export async function setupBuildDirectories(
  adapter: RuntimeAdapter,
  outputDir: string,
  dryRun: boolean,
): Promise<void> {
  logger.debug("Setting up build directories...");

  if (dryRun) {
    logger.debug("Build directories ready");
    return;
  }

  try {
    await adapter.fs.remove(outputDir, { recursive: true });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const dirs = [
    outputDir,
    join(outputDir, "_veryfront"),
    join(outputDir, "_veryfront/chunks"),
    join(outputDir, "_veryfront/data"),
    join(outputDir, "assets"),
  ];

  for (const dir of dirs) {
    await adapter.fs.mkdir(dir, { recursive: true });
  }

  logger.debug("Build directories ready");
}
