import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { type ChunkManifest, createCodeSplitter } from "#veryfront/build/bundler/index.ts";
import type { RouteInfo } from "#veryfront/server/build-types.ts";

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
    return { manifest: null, chunks: 0 };
  }

  logger.info("Running code splitter...");

  const splitter = createCodeSplitter({
    projectDir,
    outDir: join(outputDir, "_veryfront/chunks"),
    mode: "production",
    routes: routes.map(({ path, file, slug }) => ({
      path,
      file,
      name: slug.replaceAll("/", "-"),
    })),
    shared: ["react", "react-dom"],
    external: [],
  });

  const { entries, shared, manifest } = await splitter.split();
  const chunks = entries.size + shared.size;

  logger.info(`Created ${chunks} chunks`);

  return { manifest, chunks };
}
