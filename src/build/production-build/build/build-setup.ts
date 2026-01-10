import { serverLogger as logger } from "@veryfront/utils";
import { join } from "node:path";
import { handleErrorWithFallback } from "@veryfront/errors/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";

export async function setupBuildDirectories(
  adapter: RuntimeAdapter,
  outputDir: string,
  dryRun: boolean,
): Promise<void> {
  logger.info("Setting up build directories...");

  // Clean existing output directory
  await handleErrorWithFallback(
    async () => await adapter.fs.remove(outputDir, { recursive: true }),
    undefined,
    logger,
  );

  // Create directory structure if not a dry run
  if (!dryRun) {
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
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "EEXIST"
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  logger.info("Build directories ready");
}
