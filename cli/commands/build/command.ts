import { join } from "veryfront/platform/path";
import { runtime } from "veryfront/platform";
import { getConfig } from "veryfront/config";
import { buildProduction } from "veryfront/build";
import { withSpan } from "veryfront/observability/otlp-setup";
import { displayBuildConfig, displayBuildStart } from "./config-display.ts";
import { handleBuildError } from "./error-handler.ts";
import { displayBuildSuccess } from "./stats-display.ts";
import type { BuildOptions } from "./types.ts";

export function buildCommand(options: BuildOptions): Promise<void> {
  return withSpan(
    "cli.command.build",
    async () => {
      const outputDir = options.outputDir ?? join(options.projectDir, "dist");
      const startTime = Date.now();
      const dryRun = options.dryRun ?? false;

      try {
        displayBuildConfig({ ...options, outputDir });

        const adapter = await runtime.get();
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
          dryRun,
        });

        displayBuildSuccess(stats, startTime, outputDir, dryRun);
      } catch (error) {
        handleBuildError(error);
      }
    },
    { "cli.projectDir": options.projectDir },
  );
}
