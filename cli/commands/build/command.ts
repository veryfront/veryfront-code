import { isAbsolute, join, relative, resolve } from "veryfront/platform/path";
import { runtime } from "veryfront/platform";
import { getConfig, type VeryfrontConfig } from "veryfront/config";
import { CONFIG_INVALID } from "veryfront/errors";
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

/**
 * Decide where the build writes.
 *
 * `-o/--output` wins, then `build.outDir` from veryfront.config.ts, then
 * `dist`. `build.outDir` used to be read into the config object and dropped:
 * the build wrote (and cleared) `dist` regardless, with no warning, so the
 * documented way to keep the framework out of a project's own `dist/` did
 * nothing. A relative `outDir` resolves against the project directory, which
 * is how a config file naturally reads.
 */
export function resolveBuildOutputDir(
  projectDir: string,
  explicitOutputDir: string | undefined,
  config: Pick<VeryfrontConfig, "build">,
  options: { clearsOutputDir?: boolean } = {},
): string {
  const outputDir = explicitOutputDir ?? resolveConfiguredOutputDir(projectDir, config);
  // The guard below exists because the caller wipes the directory first. A
  // caller that only writes into it is not dangerous, and rejecting it would
  // block legitimate invocations — see the embedded preset.
  if (options.clearsOutputDir !== false) {
    assertOutputDirExcludesProject(projectDir, outputDir, explicitOutputDir !== undefined);
  }
  return outputDir;
}

function resolveConfiguredOutputDir(
  projectDir: string,
  config: Pick<VeryfrontConfig, "build">,
): string {
  const configured = config.build?.outDir;
  if (configured === undefined || configured === "") return join(projectDir, "dist");
  const resolvedProject = resolve(projectDir);
  const resolvedOutput = resolve(resolvedProject, configured);
  const relativeOutput = relative(resolvedProject, resolvedOutput);
  if (
    relativeOutput === "" || relativeOutput.startsWith("..") ||
    isAbsolute(relativeOutput)
  ) {
    throw CONFIG_INVALID.create({
      detail: "build.outDir must resolve to a directory inside the project",
    });
  }
  return resolvedOutput;
}

/**
 * Refuse an output directory that is the project directory or an ancestor of it.
 *
 * The production build clears its output directory before writing
 * (`build-setup.ts` removes it recursively), so an `outDir` of `.` or `..`
 * would recursively delete the project's own source — or the workspace above
 * it. This is why the check is opt-out via `clearsOutputDir`: a caller that
 * only writes into the directory, like the embedded preset, carries no such
 * risk and must not be blocked. That was unreachable while `build.outDir` was ignored; now that the
 * config value is honored, a stale compatibility-era config could reach it.
 * Failing loudly is the only safe answer: silently substituting `dist` would
 * reintroduce the ignored-configuration bug this change exists to fix.
 */
function assertOutputDirExcludesProject(
  projectDir: string,
  outputDir: string,
  fromFlag: boolean,
): void {
  const resolvedOutput = resolve(projectDir, outputDir);
  const relativeToOutput = relative(resolvedOutput, resolve(projectDir));
  const containsProject = relativeToOutput === "" ||
    (!relativeToOutput.startsWith("..") && !isAbsolute(relativeToOutput));
  if (!containsProject) return;

  const source = fromFlag ? "-o/--output" : "build.outDir";
  throw CONFIG_INVALID.create({
    detail:
      `${source} resolves to ${resolvedOutput}, which is the project directory or contains it. ` +
      `The build clears its output directory before writing, so this would delete the project. ` +
      `Point the build at a directory of its own, such as dist.`,
  });
}

export function buildCommand(options: BuildOptions): Promise<void> {
  return withSpan(
    "cli.command.build",
    async () => {
      // Placeholder until the config is loaded; every path that reports or
      // writes the output directory runs after resolveBuildOutputDir below.
      let outputDir = options.outputDir ?? join(options.projectDir, "dist");
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
        }

        const stats = await runWithBundlerShutdown(async () => {
          const adapter = await runtime.get();
          const config = await getConfig(options.projectDir, adapter);
          // Resolved from the loaded config, so the displayed, reported and
          // written output directory are the same one.
          outputDir = resolveBuildOutputDir(options.projectDir, options.outputDir, config);
          if (!isJsonMode()) displayBuildConfig({ ...options, outputDir });
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
