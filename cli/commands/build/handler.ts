import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { bold, cyan, dim, green, yellow } from "#cli/ui";
import { join } from "veryfront/platform/path";
import { cliLogger } from "#cli/utils";
import { cwd } from "veryfront/platform";
import { buildCommand } from "./command.ts";
import { CommonArgs, createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { exitProcess, showLogo } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";

/**
 * Schema factory for build command arguments
 */
export const getBuildArgsSchema = defineSchema((v) =>
  v.object({
    output: v.string().optional(),
    preset: v.string().optional(),
    split: v.boolean().default(true),
    compress: v.boolean().default(true),
    prefetch: v.boolean().default(true),
    ssg: v.boolean().default(true),
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
  compress: { keys: ["compress"], type: "boolean" },
  prefetch: { keys: ["prefetch"], type: "boolean" },
  ssg: { keys: ["ssg"], type: "boolean" },
  noSsg: { keys: ["no-ssg"], type: "boolean" },
  include: { keys: ["include"], type: "array" },
  exclude: { keys: ["exclude"], type: "array" },
  dryRun: CommonArgs.dryRun,
});

export async function handleBuildCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const opts = parseArgsOrThrow(parseBuildArgs, "build", args);
  const projectDir = cwd();
  const preset = opts.preset?.toLowerCase();

  if (preset === "embedded") {
    await handleEmbeddedBuild(projectDir, opts.output);
    return;
  }

  await buildCommand({
    projectDir,
    outputDir: opts.output,
    splitting: opts.split,
    compress: opts.compress,
    prefetch: opts.prefetch,
    ssg: opts.ssg && !opts.noSsg,
    include: opts.include,
    exclude: opts.exclude,
    dryRun: opts.dryRun,
  });

  // Build tools (esbuild) may leave hanging timers; force clean exit
  exitProcess(0);
}

async function handleEmbeddedBuild(projectDir: string, outputDir?: string): Promise<void> {
  const { buildEmbeddedPreset } = await import("veryfront/build");

  const finalOutput = outputDir ?? join(projectDir, "dist");

  cliLogger.info(bold(cyan("\n🔗 Veryfront Embedded Preset Build\n")));
  cliLogger.info("Starting embedded preset build");
  cliLogger.info(yellow("\nBuild Configuration:"));
  cliLogger.info(`  ${dim("Project:")}    ${projectDir}`);
  cliLogger.info(`  ${dim("Output:")}     ${finalOutput}`);
  cliLogger.info(`  ${dim("Preset:")}     embedded`);
  cliLogger.info("\n");

  await buildEmbeddedPreset({
    projectDir,
    outDir: finalOutput,
    runtime: "deno",
  });

  cliLogger.info(`\n${green("✓")}${bold(green(" Embedded bundle created!\n"))}`);

  const { getPostBuildTips } = await import("../../help/tips.ts");
  console.log(getPostBuildTips());
}
