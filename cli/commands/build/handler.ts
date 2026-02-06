import { z } from "zod";
import { bold, cyan, dim, green, yellow } from "#veryfront/compat/console";
import { join } from "#veryfront/compat/path/index.ts";
import { cliLogger } from "#veryfront/utils";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { buildCommand } from "./command.ts";
import { CommonArgs, createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { exitProcess, showLogo } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";

/**
 * Zod schema for build command arguments
 */
export const BuildArgsSchema = z.object({
  output: z.string().optional(),
  preset: z.string().optional(),
  split: z.boolean().default(true),
  compress: z.boolean().default(true),
  prefetch: z.boolean().default(true),
  ssg: z.boolean().default(true),
  noSsg: z.boolean().default(false),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  dryRun: z.boolean().default(false),
});

/**
 * Build command options (inferred from schema)
 */
export type BuildOptions = z.infer<typeof BuildArgsSchema>;

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
  const { buildEmbeddedPreset } = await import("#veryfront/build/index.ts");

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
}
