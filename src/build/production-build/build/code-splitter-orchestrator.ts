
import { serverLogger as logger } from "@veryfront/utils";
import { join } from "node:path";
import { type ChunkManifest, createCodeSplitter } from "@veryfront/build/bundler/index.ts";
import type { RouteInfo } from "@veryfront/server/build-types.ts";

export interface SplitResult {
  manifest: ChunkManifest | null;
  chunks: number;
}

export async function runCodeSplitting(
  projectDir: string,
  outputDir: string,
  routes: RouteInfo[],
  enableSplitting: boolean,
  dryRun: boolean,
): Promise<SplitResult> {
  if (!enableSplitting || dryRun || routes.length === 0) {
    return {
      manifest: null,
      chunks: 0,
    };
  }

  logger.info("Running code splitter...");

  const splitter = createCodeSplitter({
    projectDir,
    outDir: join(outputDir, "_veryfront/chunks"),
    mode: "production",
    routes: routes.map((r) => ({
      path: r.path,
      file: r.file,
      name: r.slug.replace(/\
    })),
    shared: ["react", "react-dom"],
    external: [],
  });

  const splitResult = await splitter.split();
  const chunks = splitResult.entries.size + splitResult.shared.size;

  logger.info(`Created ${chunks} chunks`);

  return {
    manifest: splitResult.manifest,
    chunks,
  };
}
