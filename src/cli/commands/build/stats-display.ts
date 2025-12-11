
import { bold, cyan, dim, green, yellow } from "@veryfront/compat/console";
import { cliLogger } from "@veryfront/utils";
import type { BuildStats } from "./types.ts";

export function displayBuildSuccess(
  stats: BuildStats,
  startTime: number,
  outputDir: string,
  dryRun: boolean,
): void {
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  cliLogger.info(`\n${green("✓")}${bold(green(" Build completed successfully!\n"))}`);

  cliLogger.info(cyan("📊 Build Statistics"));
  cliLogger.info(dim("─".repeat(40)));
  cliLogger.info(`  Pages       ${bold(String(stats.pages).padStart(6))} files`);
  cliLogger.info(`  Chunks      ${bold(String(stats.chunks).padStart(6))} files`);
  cliLogger.info(`  Assets      ${bold(String(stats.assets).padStart(6))} files`);
  cliLogger.info(dim("─".repeat(40)));
  cliLogger.info(
    `  Total size  ${bold((stats.totalSize / 1024 / 1024).toFixed(2).padStart(6))} MB`,
  );
  cliLogger.info(`  Build time  ${bold(duration.padStart(6))} seconds`);
  cliLogger.info("");

  if (dryRun && stats.ssgPaths && Array.isArray(stats.ssgPaths)) {
    cliLogger.info(yellow("📝 SSG routes that would be generated:"));
    for (const p of stats.ssgPaths) {
      cliLogger.info(`  ${dim("•")} ${p}`);
    }
    cliLogger.info("");
  }

  cliLogger.info(green("✨") + bold(" Your site is ready for deployment!"));
  cliLogger.info(`\n  ${dim("Output directory:")} ${cyan(outputDir)}`);
  cliLogger.info(`\n  ${dim("Next steps:")}`);
  cliLogger.info(`    ${dim("•")} ${cyan("veryfront serve")} to preview locally`);
  cliLogger.info(`    ${dim("•")} Deploy the ${cyan("dist")} directory to your host`);
  cliLogger.info("");
}
