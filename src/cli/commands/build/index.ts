
import { join } from "std/path/mod.ts";
import { getAdapter } from "@veryfront/platform/adapters/index.ts";
import { getConfig } from "@veryfront/config";
import { buildProduction } from "@veryfront/build/production-build/index.ts";
import { displayBuildConfig, displayBuildStart } from "./config-display.ts";
import { handleBuildError } from "./error-handler.ts";
import { displayBuildSuccess } from "./stats-display.ts";
import type { BuildOptions } from "./types.ts";

export async function buildCommand(options: BuildOptions): Promise<void> {
  const outputDir = options.outputDir || join(options.projectDir, "dist");
  const startTime = Date.now();

  try {
    displayBuildConfig({ ...options, outputDir });

    const adapter = await getAdapter();
    await getConfig(options.projectDir, adapter);

    displayBuildStart();

    const stats = await buildProduction({
      projectDir: options.projectDir,
      outputDir,
      enableSplitting: options.splitting ?? true,
      enableCompression: options.compress ?? true,
      enablePrefetch: options.prefetch ?? true,
      ssg: options.ssg ?? true,
      include: options.include,
      exclude: options.exclude,
      dryRun: options.dryRun ?? false,
    });

    displayBuildSuccess(stats, startTime, outputDir, options.dryRun ?? false);
  } catch (error) {
    handleBuildError(error);
  }
}
