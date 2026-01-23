/**
 * Build Command Orchestrator
 *
 * Thin orchestration layer that coordinates build phases:
 * - Configuration display
 * - Build execution
 * - Statistics display
 * - Error handling
 */

import { join } from "#veryfront/platform/compat/path/index.ts";
// Direct import from registry.ts to avoid circular dependency through barrel
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { getConfig } from "#veryfront/config";
import { buildProduction } from "#veryfront/build/production-build/index.ts";
import { displayBuildConfig, displayBuildStart } from "./config-display.ts";
import { handleBuildError } from "./error-handler.ts";
import { displayBuildSuccess } from "./stats-display.ts";
import type { BuildOptions } from "./types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

/**
 * Main build command entry point
 */
export function buildCommand(options: BuildOptions): Promise<void> {
  return withSpan("cli.command.build", async () => {
    const outputDir = options.outputDir || join(options.projectDir, "dist");
    const startTime = Date.now();

    try {
      // Display configuration
      displayBuildConfig({ ...options, outputDir });

      // Initialize adapter and config
      const adapter = await runtime.get();
      await getConfig(options.projectDir, adapter);

      // Start build
      displayBuildStart();

      // Execute production build
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

      // Display success and statistics
      displayBuildSuccess(stats, startTime, outputDir, options.dryRun ?? false);
    } catch (error) {
      handleBuildError(error);
    }
  }, { "cli.projectDir": options.projectDir });
}
