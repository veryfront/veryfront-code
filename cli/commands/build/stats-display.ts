import { dim } from "#cli/ui";
import { cliLogger, formatBytes } from "#cli/utils";
import type { BuildStats } from "./types.ts";

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function displayBuildSuccess(
  stats: BuildStats,
  startTime: number,
  outputDir: string,
  dryRun: boolean,
): void {
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  cliLogger.info(`  ✓ Built in ${duration}s`);
  cliLogger.info(
    `    ${formatCount(stats.pages, "page")}, ${formatCount(stats.chunks, "chunk")}, ${
      formatCount(stats.assets, "asset")
    }`,
  );
  cliLogger.info(`    ${formatBytes(stats.totalSize)} in ${outputDir}`);

  if (dryRun && stats.ssgPaths?.length) {
    cliLogger.info(`    ${dim("SSG routes:")} ${stats.ssgPaths.join(", ")}`);
  }

  cliLogger.info("");
}
