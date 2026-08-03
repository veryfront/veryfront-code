import { dim, warning } from "#cli/ui";
import { cliLogger, isVerbose } from "#cli/utils";
import type { BuildOptions } from "./types.ts";

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

  if (isVerbose()) {
    const features = [
      splitting && "splitting",
      compress && "compression",
      prefetch && "prefetch",
      ssg && "SSG",
    ].filter(Boolean).join(", ") || "none";

    cliLogger.info(`  ${dim("Project:")} ${projectDir}`);
    cliLogger.info(`  ${dim("Output:")} ${outputDir ?? "dist"}`);
    cliLogger.info(`  ${dim("Features:")} ${features}`);
    if (include?.length) cliLogger.info(`  ${dim("Include:")} ${include.join(", ")}`);
    if (exclude?.length) cliLogger.info(`  ${dim("Exclude:")} ${exclude.join(", ")}`);
    cliLogger.info("");
  }

  if (dryRun) {
    cliLogger.info(`  ${warning("!")} Dry run: no files will be written`);
    cliLogger.info("");
  }
}

export function displayBuildStart(): void {
  cliLogger.info("Building...");
}
