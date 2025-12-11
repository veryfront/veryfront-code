
import { cliLogger } from "@veryfront/utils";
import { buildCommand } from "../commands/build.ts";
import { parseArrayArg } from "./arg-parser.ts";
import type { BuildCommandArgs } from "./types.ts";
import { cwd } from "../../platform/compat/process.ts";

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
    dryRun: Boolean(args["dry-run"]) || Boolean(args.dryrun),
  });
}

async function handleEmbeddedBuild(projectDir: string, outputDir?: string): Promise<void> {
  const { bold, cyan, dim, green, yellow } = await import("std/fmt/colors.ts");
  const { join } = await import("std/path/mod.ts");
  const { buildEmbeddedPreset } = await import("../../build/index.ts");

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
