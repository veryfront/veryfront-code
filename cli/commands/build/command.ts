import { join } from "veryfront/platform/path";
import { runtime } from "veryfront/platform";
import { getConfig } from "veryfront/config";
import { buildProduction } from "veryfront/build";
import { withSpan } from "veryfront/observability/otlp-setup";
import { displayBuildConfig, displayBuildStart } from "./config-display.ts";
import { handleBuildError } from "./error-handler.ts";
import { displayBuildSuccess } from "./stats-display.ts";
import type { BuildOptions } from "./types.ts";
import { isJsonMode, streamJsonLine } from "../../shared/json-output.ts";
import { ensureBuiltinContentProcessor } from "../../shared/ensure-content-processor.ts";

export function buildCommand(options: BuildOptions): Promise<void> {
  return withSpan(
    "cli.command.build",
    async () => {
      const outputDir = options.outputDir ?? join(options.projectDir, "dist");
      const startTime = Date.now();
      const dryRun = options.dryRun ?? false;

      try {
        if (isJsonMode()) {
          streamJsonLine({ type: "step", name: "config", status: "started" });
        } else {
          displayBuildConfig({ ...options, outputDir });
        }

        const adapter = await runtime.get();
        await getConfig(options.projectDir, adapter);
        ensureBuiltinContentProcessor();

        if (isJsonMode()) {
          streamJsonLine({ type: "step", name: "config", status: "completed" });
          streamJsonLine({ type: "step", name: "build", status: "started" });
        } else {
          displayBuildStart();
        }

        const stats = await buildProduction({
          projectDir: options.projectDir,
          outputDir,
          enableSplitting: options.splitting ?? true,
          enableCompression: options.compress ?? true,
          enablePrefetch: options.prefetch ?? true,
          ssg: options.ssg ?? false,
          include: options.include,
          exclude: options.exclude,
          dryRun,
        });

        const elapsed = Date.now() - startTime;

        if (isJsonMode()) {
          streamJsonLine({
            type: "step",
            name: "build",
            status: "completed",
            duration_ms: elapsed,
          });
          streamJsonLine({
            type: "result",
            success: true,
            data: {
              pages: stats.pages,
              chunks: stats.chunks,
              assets: stats.assets,
              totalSize: stats.totalSize,
              duration_ms: elapsed,
              outputDir,
              dryRun,
            },
          });
          return;
        }

        displayBuildSuccess(stats, startTime, outputDir, dryRun);
      } catch (error) {
        if (isJsonMode()) {
          streamJsonLine({
            type: "result",
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
          const { exit } = await import("veryfront/platform");
          exit(1);
          return;
        }
        handleBuildError(error);
      }
    },
    { "cli.projectDir": options.projectDir },
  );
}
