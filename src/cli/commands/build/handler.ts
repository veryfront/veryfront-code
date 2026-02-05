import { cliLogger } from "#veryfront/utils";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { buildCommand } from "./command.ts";
import { parseArrayArg } from "../../shared/arg-parser.ts";
import { exitProcess, showLogo } from "../../utils/index.ts";
import type { BuildCommandArgs } from "../../shared/types.ts";

export async function handleBuildCommand(args: BuildCommandArgs): Promise<void> {
  showLogo();
  const projectDir = cwd();
  const outputDir = args.output ?? args.o;
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

  // Build tools (esbuild) may leave hanging timers; force clean exit
  exitProcess(0);
}

async function handleEmbeddedBuild(projectDir: string, outputDir?: string): Promise<void> {
  const { bold, cyan, dim, green, yellow } = await import("std/fmt/colors.ts");
  const { join } = await import("std/path/mod.ts");
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
