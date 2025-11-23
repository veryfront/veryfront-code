/**
 * Build Setup Module
 *
 * Handles filesystem setup and cleanup for the build process:
 * - Output directory cleanup
 * - Directory structure creation
 * - Initial filesystem preparation
 */

import { serverLogger as logger } from "@veryfront/utils";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { handleErrorWithFallback } from "@veryfront/errors/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";

/**
 * Clean and prepare the output directory for the build
 */
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
    const dirs = [
      outputDir,
      join(outputDir, "_veryfront"),
      join(outputDir, "_veryfront/chunks"),
      join(outputDir, "_veryfront/data"),
      join(outputDir, "assets"),
    ];

    for (const dir of dirs) {
      try {
        await mkdir(dir, { recursive: true });
      } catch (error) {
        if (error && typeof error === "object" && (error as Deno.errors.AlreadyExists)) {
          continue;
        }
        throw error;
      }
    }
  }

  logger.info("Build directories ready");
}
