import { join, relative, resolve } from "veryfront/platform/path";
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
import { setupBuildCliExtensions } from "../../shared/build-extensions.ts";

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

/**
 * Release the extensions composed for this build.
 *
 * Extensions can hold timers and other resources, and `teardownAll()` also
 * clears the process-global contract registry that `orchestrateExtensions`
 * populated. `veryfront eval` and `veryfront serve` already do this; the build
 * did not, so a command that composes extensions left them running.
 *
 * A teardown failure never changes the build's outcome. The build has already
 * produced its result by this point, and `runWithBundlerShutdown` sets the
 * same precedent by preserving the build error over a shutdown one.
 *
 * @internal
 */
export async function releaseBuildExtensions(
  loader: { teardownAll: () => Promise<void> } | undefined,
): Promise<void> {
  if (!loader) return;
  try {
    await loader.teardownAll();
  } catch {
    if (!isJsonMode()) {
      cliLogger.warn("Extension teardown failed after the build");
    }
  }
}

export function formatBuildOutputPath(projectDir: string, outputDir: string): string {
  return relative(projectDir, resolve(projectDir, outputDir)).replace(/\\/g, "/");
}

export function buildCommand(options: BuildOptions): Promise<void> {
  return withSpan(
    "cli.command.build",
    async () => {
      const outputDir = options.outputDir ?? join(options.projectDir, "dist");
      const startTime = Date.now();
      const dryRun = options.dryRun ?? false;
      let extensions: Awaited<ReturnType<typeof setupBuildCliExtensions>> | undefined;
      // exit() does not run `finally`, so the JSON error path below releases
      // explicitly before exiting. Clearing the handle keeps that idempotent.
      const releaseExtensions = async (): Promise<void> => {
        const loader = extensions;
        extensions = undefined;
        await releaseBuildExtensions(loader);
      };

      try {
        if (isJsonMode()) {
          streamJsonLine({ type: "step", name: "config", status: "started" });
        } else {
          displayBuildConfig({ ...options, outputDir });
        }

        const stats = await runWithBundlerShutdown(async () => {
          const adapter = await runtime.get();
          const config = await getConfig(options.projectDir, adapter);
          // Compose the project's extensions before anything that resolves a
          // contract. Only server bootstrap used to do this, so the build ran
          // with whatever one-off shims had been added and failed on the rest.
          extensions = await setupBuildCliExtensions(options.projectDir, config);
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
            // Tri-state: buildProduction resolves an omitted flag against
            // build.ssg in veryfront.config.ts, then defaults to enabled.
            ssg: options.ssg,
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

        displayBuildSuccess(
          stats,
          startTime,
          formatBuildOutputPath(options.projectDir, outputDir),
          dryRun,
        );
      } catch (error) {
        if (isJsonMode()) {
          streamJsonLine({
            type: "result",
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
          await releaseExtensions();
          const { exit } = await import("veryfront/platform");
          exit(1);
          return;
        }
        handleBuildError(error);
      } finally {
        await releaseExtensions();
      }
    },
    { "cli.projectDir": options.projectDir },
  );
}
