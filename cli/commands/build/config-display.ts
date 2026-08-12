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
    // Emit the section break directly: the CLI logger preset renders every
    // message as `  <glyph> <message>`, so an empty message prints a bare
    // glyph line instead of a blank one.
    console.log("");
  }

  if (dryRun) {
    cliLogger.info(`  ${warning("!")} Dry run: no files will be written`);
    console.log("");
  }
}

export function displayBuildStart(): void {
  cliLogger.info("Building...");
}
