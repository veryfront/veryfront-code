/**
 * Build Configuration Display Module
 *
 * Handles displaying build configuration to the user.
 */

import { bold, cyan, dim, green, red, yellow } from "@veryfront/compat/console";
import { cliLogger } from "@veryfront/utils";
import type { BuildOptions } from "./types.ts";

/**
 * Display build header and configuration
 */
export function displayBuildConfig(options: BuildOptions): void {
  const {
    projectDir,
    outputDir,
    splitting = true,
    compress = true,
    prefetch = true,
    ssg = true,
    include,
    exclude,
    dryRun = false,
  } = options;

  // Show build header and start message (kept for CLI tests)
  cliLogger.info(bold(cyan("\n🚀 Veryfront Production Build\n")));
  cliLogger.info("Starting production build");

  // Show build configuration
  cliLogger.info(yellow("\nBuild Configuration:"));
  cliLogger.info(`  ${dim("Project:")}    ${projectDir}`);
  cliLogger.info(`  ${dim("Output:")}     ${outputDir || "dist"}`);
  cliLogger.info(`  ${dim("Features:")}`);
  cliLogger.info(`    ${splitting ? green("✓") : red("✗")} Code splitting`);
  cliLogger.info(`    ${compress ? green("✓") : red("✗")} Compression`);
  cliLogger.info(`    ${prefetch ? green("✓") : red("✗")} Prefetch hints`);
  cliLogger.info(`    ${ssg ? green("✓") : red("✗")} Static generation`);

  if (include?.length) {
    cliLogger.info(`\n  ${dim("Include:")} ${include.join(", ")}`);
  }
  if (exclude?.length) {
    cliLogger.info(`  ${dim("Exclude:")} ${exclude.join(", ")}`);
  }
  if (dryRun) {
    cliLogger.info(`\n  ${yellow("⚠")}  ${yellow("Dry run mode - no files will be written")}`);
    // Emit token used by CLI tests
    cliLogger.info("dry-run");
  }
  cliLogger.info("");
}

/**
 * Display build start message
 */
export function displayBuildStart(): void {
  cliLogger.info(cyan("Building your application...\n"));
}
