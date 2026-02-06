import { z } from "zod";
import { cliLogger } from "#veryfront/utils";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { buildCommand } from "./command.ts";
import { createArgParser } from "../../shared/args.ts";
import { exitProcess, showLogo } from "../../utils/index.ts";
import type { ParsedArgs } from "../../shared/types.ts";

/** Coerce a string-or-array arg into a string array */
const stringArraySchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((val) => {
    if (Array.isArray(val)) return val;
    if (val) return [val];
    return undefined;
  });

const BuildArgsSchema = z.object({
  outputDir: z.string().optional(),
  preset: z.string().optional(),
  splitting: z.boolean().default(true),
  compress: z.boolean().default(true),
  prefetch: z.boolean().default(true),
  ssg: z.boolean().default(true),
  noSsg: z.boolean().default(false),
  include: stringArraySchema,
  exclude: stringArraySchema,
  dryRun: z.boolean().default(false),
});

const parseBuildArgs = createArgParser(BuildArgsSchema, {
  outputDir: { keys: ["output", "o"], type: "string" },
  preset: { keys: ["preset"], type: "string" },
  splitting: { keys: ["split"], type: "boolean" },
  compress: { keys: ["compress"], type: "boolean" },
  prefetch: { keys: ["prefetch"], type: "boolean" },
  ssg: { keys: ["ssg"], type: "boolean" },
  noSsg: { keys: ["no-ssg"], type: "boolean" },
  include: { keys: ["include"], type: "string" },
  exclude: { keys: ["exclude"], type: "string" },
  dryRun: { keys: ["dry-run", "dryrun"], type: "boolean" },
});

export async function handleBuildCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parseBuildArgs(args);
  if (!result.success) {
    throw new Error(`Invalid build arguments: ${result.error.message}`);
  }

  const { preset, noSsg, ssg, ...rest } = result.data;
  const projectDir = cwd();

  if (preset?.toLowerCase() === "embedded") {
    await handleEmbeddedBuild(projectDir, rest.outputDir);
    return;
  }

  await buildCommand({
    ...rest,
    projectDir,
    ssg: ssg && !noSsg,
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
