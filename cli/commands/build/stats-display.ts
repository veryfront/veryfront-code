import { dim } from "#cli/ui";
import { formatBytes, logSuccess } from "#cli/utils";
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
  logSuccess(`Built in ${duration}s`);
  console.log(
    `    ${formatCount(stats.pages, "page")}, ${formatCount(stats.chunks, "chunk")}, ${
      formatCount(stats.assets, "asset")
    }`,
  );
  console.log(`    ${formatBytes(stats.totalSize)} in ${outputDir}`);

  if (dryRun && stats.ssgPaths?.length) {
    console.log(`    ${dim("SSG routes:")} ${stats.ssgPaths.join(", ")}`);
  }

  console.log();
}
