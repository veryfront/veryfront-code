/**
 * Build command handler for CLI
 *
 * @module cli/index/build-handler
 */

import { cliLogger } from "../../utils/index.js";
import { cwd } from "../../platform/compat/process.js";
import { buildCommand } from "../commands/build.js";
import { parseArrayArg } from "./arg-parser.js";
import type { BuildCommandArgs } from "./types.js";

export async function handleBuildCommand(args: BuildCommandArgs): Promise<void> {
  const projectDir = cwd();
  const outputDir = args.output || args.o;
  const preset = args.preset ? String(args.preset).toLowerCase() : undefined;

  if (preset === "embedded") {
    await handleEmbeddedBuild(projectDir, outputDir);
    return;
  }

  await buildCommand({
    projectDir,
    outputDir,
    splitting: args.split !== false,
    compress: args.compress !== false,
    prefetch: args.prefetch !== false,
    ssg: args.ssg !== false && args["no-ssg"] !== true,
    include: parseArrayArg(args.include),
    exclude: parseArrayArg(args.exclude),
    dryRun: Boolean(args["dry-run"] ?? args.dryrun),
  });
}

async function handleEmbeddedBuild(projectDir: string, outputDir?: string): Promise<void> {
  const { bold, cyan, dim, green, yellow } = await import("picocolors");
  const { join } = await import("../../../deps/deno.land/std@0.220.0/path/mod.js");
  const { buildEmbeddedPreset } = await import("../../build/index.js");

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
