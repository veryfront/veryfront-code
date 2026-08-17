import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { dim } from "#cli/ui";
import { cliLogger, isVerbose, logSuccess } from "#cli/utils";
import { cwd, runtime } from "veryfront/platform";
import { CommonArgs, createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { ensureCliBundlerContracts } from "#cli/shared/default-contracts";
import { showHeader } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { ensureBuiltinContentProcessor } from "../../shared/ensure-content-processor.ts";
import { isJsonMode, streamJsonLine } from "../../shared/json-output.ts";

/**
 * Schema factory for build command arguments
 */
export const getBuildArgsSchema = defineSchema((v) =>
  v.object({
    output: v.string().optional(),
    preset: v.string().optional(),
    split: v.boolean().default(true),
    noSplit: v.boolean().default(false),
    compress: v.boolean().default(true),
    noCompress: v.boolean().default(false),
    prefetch: v.boolean().default(true),
    ssg: v.boolean().optional(),
    noSsg: v.boolean().default(false),
    include: v.array(v.string()).optional(),
    exclude: v.array(v.string()).optional(),
    dryRun: v.boolean().default(false),
  })
);

export const BuildArgsSchema = lazySchema(getBuildArgsSchema);

/**
 * Build command options (inferred from schema)
 */
export type BuildOptions = InferSchema<ReturnType<typeof getBuildArgsSchema>>;

/**
 * Parse CLI arguments into validated BuildOptions
 */
export const parseBuildArgs = createArgParser(BuildArgsSchema, {
  output: CommonArgs.output,
  preset: { keys: ["preset"], type: "string" },
  split: { keys: ["split"], type: "boolean" },
  noSplit: { keys: ["no-split"], type: "boolean" },
  compress: { keys: ["compress"], type: "boolean" },
  noCompress: { keys: ["no-compress"], type: "boolean" },
  prefetch: { keys: ["prefetch"], type: "boolean" },
  ssg: { keys: ["ssg"], type: "boolean" },
  noSsg: { keys: ["no-ssg"], type: "boolean" },
  include: { keys: ["include"], type: "array" },
  exclude: { keys: ["exclude"], type: "array" },
  dryRun: CommonArgs.dryRun,
}, { rejectUnknown: true });

/**
 * Flags the embedded preset cannot honour, in the spelling the user types.
 *
 * The embedded preset emits one esbuild bundle: there is nothing to split,
 * no compression pass, no prefetch manifest and no prerender step, so
 * `--split`, `--compress`, `--prefetch`, `--ssg`, `--include` and `--exclude`
 * describe stages it does not have. `--dry-run` is different in kind — the
 * preset simply never implemented it, and a flag whose whole contract is
 * "changes nothing" writing to disk is the worst outcome of the three.
 *
 * Rejecting is the honest answer for all of them. Accepting a flag and
 * dropping it, which is what this path used to do, tells the user the build
 * ran the way they asked when it did not.
 */
const UNSUPPORTED_EMBEDDED_FLAGS = [
  "dry-run",
  "split",
  "no-split",
  "compress",
  "no-compress",
  "prefetch",
  "ssg",
  "no-ssg",
  "include",
  "exclude",
] as const;

/**
 * Refuse an embedded build that was given a flag the preset cannot honour.
 *
 * Reads `__explicit` from the *raw* args rather than the parsed options on
 * purpose. The schema defaults `split`, `compress` and `prefetch` to `true`
 * and `dryRun`, `noSplit`, `noCompress` and `noSsg` to `false`, so the parsed
 * object cannot tell a typed flag from a default — keying off it would reject
 * every embedded build, including a bare one.
 *
 * The message starts with `Invalid ` so the router maps it to exit code 2 as a
 * usage error, matching `parseArgsOrThrow`.
 *
 * @param args raw parsed argv, carrying `__explicit`
 * @param preset the lowercased `--preset` value, if any
 * @internal
 */
export function assertEmbeddedPresetFlags(
  args: ParsedArgs,
  preset: string | undefined,
): void {
  if (preset !== "embedded") return;

  const explicit = args.__explicit ?? {};
  const unsupported = UNSUPPORTED_EMBEDDED_FLAGS
    .filter((flag) => explicit[flag] === true)
    .map((flag) => `--${flag}`);
  if (unsupported.length === 0) return;

  throw new Error(
    `Invalid build arguments: the embedded preset does not support ${unsupported.join(", ")}`,
  );
}

export async function handleBuildCommand(args: ParsedArgs): Promise<void> {
  showHeader();
  const opts = parseArgsOrThrow(parseBuildArgs, "build", args);
  const preset = opts.preset?.toLowerCase();
  // Before any bundler setup, so a rejected build touches nothing and returns
  // immediately.
  assertEmbeddedPresetFlags(args, preset);

  await ensureCliBundlerContracts();
  const projectDir = cwd();

  if (preset === "embedded") {
    await ensureBuiltinContentProcessor();
    await handleEmbeddedBuild(projectDir, opts.output);
    return;
  }

  const { buildCommand } = await import("./command.ts");
  await buildCommand({
    projectDir,
    outputDir: opts.output,
    splitting: opts.split && !opts.noSplit,
    compress: opts.compress && !opts.noCompress,
    prefetch: opts.prefetch,
    // Tri-state: explicit --no-ssg wins, an explicit --ssg / --ssg=false is
    // passed through, and an omitted flag stays undefined so the build can
    // fall back to build.ssg from veryfront.config.ts (and its default).
    ssg: opts.noSsg ? false : opts.ssg,
    include: opts.include,
    exclude: opts.exclude,
    dryRun: opts.dryRun,
  });
}

/** The synthetic shell route `buildEmbeddedPreset` prepends to every manifest. */
const EMBEDDED_APP_SHELL_FILE = "embedded/app.js";

/**
 * Total bytes of the artifacts the embedded manifest declares.
 *
 * The production build reports the size of what it emitted, so the embedded
 * preset reports the same thing rather than leaving the field at zero. The
 * manifest is the artifact list, so it cannot drift from what was written.
 * A file the preset failed to emit is skipped: `buildEmbeddedPreset` only warns
 * when an RSC bundle or a route fails, and a size roll-up must not turn that
 * warning into a hard error.
 */
async function sumEmbeddedOutputSize(
  outDir: string,
  manifest: { routes: ReadonlyArray<{ file: string }>; assets: ReadonlyArray<{ file: string }> },
): Promise<number> {
  const { join } = await import("veryfront/platform/path");
  const { createFileSystem } = await import("veryfront/platform");
  const fs = createFileSystem();

  const files = new Set<string>(["embedded/manifest.json"]);
  for (const route of manifest.routes) files.add(route.file);
  for (const asset of manifest.assets) files.add(asset.file);

  let total = 0;
  for (const file of files) {
    try {
      total += (await fs.stat(join(outDir, file))).size;
    } catch {
      // Not emitted — already reported by the preset as a warning.
    }
  }
  return total;
}

async function handleEmbeddedBuild(projectDir: string, outputDir?: string): Promise<void> {
  const { buildEmbeddedPreset } = await import("veryfront/build");
  const { getConfig } = await import("veryfront/config");
  const { resolveBuildOutputDir } = await import("./command.ts");
  const startTime = Date.now();
  // A failure below reaches the router, which already turns it into the JSON
  // error envelope; only the success path is this function's to report.
  const json = isJsonMode();

  if (json) streamJsonLine({ type: "step", name: "config", status: "started" });

  // The config was never loaded on this path, so `build.outDir` was ignored
  // and the preset always wrote `dist`. Resolving through the same helper the
  // default path uses also brings its guard against an output directory that
  // contains the project.
  const adapter = await runtime.get();
  const config = await getConfig(projectDir, adapter);
  // `clearsOutputDir: false` because `buildEmbeddedPreset` only mkdir's and
  // writes into the target; unlike the production build it never removes it.
  // Without this, `--preset embedded -o .` — a plausible call for a preset
  // whose whole purpose is embedding into a host project — hard-fails on a
  // deletion hazard that does not exist on this path.
  const finalOutput = resolveBuildOutputDir(projectDir, outputDir, config, {
    clearsOutputDir: false,
  });

  if (json) {
    streamJsonLine({ type: "step", name: "config", status: "completed" });
    streamJsonLine({ type: "step", name: "build", status: "started" });
  } else {
    cliLogger.info("Building embedded preset...");
    if (isVerbose()) {
      cliLogger.info(`  ${dim("Project:")} ${projectDir}`);
      cliLogger.info(`  ${dim("Output:")} ${finalOutput}`);
    }
  }

  let manifest;
  try {
    ({ manifest } = await buildEmbeddedPreset({
      projectDir,
      outDir: finalOutput,
      runtime: "deno",
      config,
    }));
  } catch (error) {
    // The default path closes the stream with its own error result rather than
    // letting the router answer. Without this, a failed `--json` build has
    // already written `step` lines to stdout and then gets the router's
    // differently-shaped envelope appended — a hybrid stream no consumer can
    // parse. Rethrown afterwards so the exit code is unchanged.
    if (json) {
      streamJsonLine({
        type: "result",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }

  if (json) {
    const elapsed = Date.now() - startTime;
    streamJsonLine({
      type: "step",
      name: "build",
      status: "completed",
      duration_ms: elapsed,
    });
    // Same event and payload shape as the default build path in command.ts:
    // one command must not answer `--json` with two different result lines.
    streamJsonLine({
      type: "result",
      success: true,
      data: {
        // `buildEmbeddedPreset` unshifts a synthetic `/` -> `embedded/app.js`
        // shell route on top of the discovered ones, so counting every
        // `type: "page"` reports one more page than the project has. Measured
        // on a two-page fixture: routes are the shell, `/about`, and `/`, so
        // the naive count says 3.
        pages: manifest.routes.filter((route) =>
          route.type === "page" && route.file !== EMBEDDED_APP_SHELL_FILE
        ).length,
        // The default path reports 0 for a build with no splitting stage, and
        // the embedded preset has none — which is why `--split` is rejected for
        // it above. Reporting 1 here would answer the same field differently
        // from the command this is supposed to match.
        chunks: 0,
        assets: manifest.assets.length,
        totalSize: await sumEmbeddedOutputSize(finalOutput, manifest),
        duration_ms: elapsed,
        outputDir: finalOutput,
        // `--dry-run` is rejected for this preset, so a build that got here ran.
        dryRun: false,
      },
    });
    return;
  }

  logSuccess("Built embedded preset");
  cliLogger.info(`  ${finalOutput}\n`);
}
