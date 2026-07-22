import { join } from "veryfront/platform/path";
import { runtime } from "veryfront/platform";
import { getConfig } from "veryfront/config";
import { buildProduction } from "veryfront/build";
import { withSpan } from "veryfront/observability/otlp-setup";
import { cliLogger } from "#cli/utils";
import { displayBuildConfig, displayBuildStart } from "./config-display.ts";
import { handleBuildError } from "./error-handler.ts";
import { displayBuildSuccess } from "./stats-display.ts";
import type { BuildOptions } from "./types.ts";
import { isJsonMode, streamJsonLine } from "../../shared/json-output.ts";
import { ensureBuiltinContentProcessor } from "../../shared/ensure-content-processor.ts";

/** @internal */
export async function runWithBundlerShutdown<T>(
  operation: () => Promise<T>,
  stopBundler: () => Promise<void> = async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  },
): Promise<T> {
  let result: T;
  try {
    result = await operation();
  } catch (operationError) {
    try {
      await stopBundler();
    } catch {
      if (!isJsonMode()) {
        cliLogger.warn("Bundler shutdown also failed after the build error");
      }
    }
    throw operationError;
  }

  await stopBundler();
  return result;
}

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

        const stats = await runWithBundlerShutdown(async () => {
          const adapter = await runtime.get();
          const config = await getConfig(options.projectDir, adapter);
          await ensureBuiltinContentProcessor();

          if (isJsonMode()) {
            streamJsonLine({ type: "step", name: "config", status: "completed" });
            streamJsonLine({ type: "step", name: "build", status: "started" });
          } else {
            displayBuildStart();
          }

          return await buildProduction({
            projectDir: options.projectDir,
            outputDir,
            enableSplitting: options.splitting ?? true,
            enableCompression: options.compress ?? true,
            enablePrefetch: options.prefetch ?? true,
            // Explicit CLI flag > build.ssg in veryfront.config.ts > enabled.
            // A non-SSG build emits no pages at all, so SSG must be the
            // default for `veryfront build` to produce a deployable artifact.
            ssg: options.ssg ?? config.build?.ssg ?? true,
            include: options.include,
            exclude: options.exclude,
            dryRun,
          });
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
