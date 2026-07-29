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

  const compilationRoutes = new Map<string, string>();
  for (const route of routes) {
    if (/\.mdx?$/i.test(route.file)) continue;
    const compilationPath = route.templatePath ?? route.path;
    const existingFile = compilationRoutes.get(compilationPath);
    if (existingFile !== undefined && existingFile !== route.file) {
      throw new TypeError(
        `Code-splitting source route ${JSON.stringify(compilationPath)} maps to both ${
          JSON.stringify(existingFile)
        } and ${JSON.stringify(route.file)}`,
      );
    }
    compilationRoutes.set(compilationPath, route.file);
  }
  if (compilationRoutes.size === 0) {
    logger.debug("Skipping code splitting: document routes are compiled by the MDX pipeline");
    return { manifest: null, chunks: 0 };
  }

  logger.debug("Running code splitter...");

  const splitter = createCodeSplitter({
    projectDir,
    outDir: join(outputDir, "_veryfront/chunks"),
    mode: "production",
    routes: [...compilationRoutes]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([path, file]) => ({ path, file })),
    shared: ["react", "react-dom"],
    external: [],
  });

  const { entries, shared, manifest } = await splitter.split();
  const chunks = entries.size + shared.size;

  logger.debug(`Created ${chunks} chunks`);

  return { manifest, chunks };
}
