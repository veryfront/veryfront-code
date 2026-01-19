import { join } from "#veryfront/platform/compat/path/index.ts";
import { getAdapter } from "#veryfront/platform/adapters/index.ts";
import { getConfig } from "#veryfront/config";
import { createRenderer, type VeryfrontRenderer } from "#veryfront/rendering/index.ts";
import type { BuildOptions, BuildStats } from "#veryfront/server/build-types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/index.ts";
import type { VeryfrontConfig } from "#veryfront/config";

export interface BuildContext {
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  renderer: VeryfrontRenderer;
  options: BuildOptions;
  stats: BuildStats;
}

export async function initializeBuildContext(options: BuildOptions): Promise<BuildContext> {
  const adapter = await getAdapter();
  const config = await getConfig(options.projectDir, adapter);
  const renderer = await createRenderer({
    projectDir: options.projectDir,
    mode: "production",
    adapter,
  });

  const stats: BuildStats = {
    pages: 0,
    components: 0,
    chunks: 0,
    assets: 0,
    totalSize: 0,
    duration: 0,
  };

  return {
    adapter,
    config,
    renderer,
    options,
    stats,
  };
}

export function normalizeBuildOptions(options: BuildOptions) {
  const defaultOutputDir = join(options.projectDir, ".veryfront", "output");
  return {
    projectDir: options.projectDir,
    outputDir: options.outputDir ?? defaultOutputDir,
    enableSplitting: options.enableSplitting ?? true,
    enableCompression: options.enableCompression ?? true,
    enablePrefetch: options.enablePrefetch ?? true,
    ssg: options.ssg ?? true,
    include: options.include,
    exclude: options.exclude,
    dryRun: options.dryRun ?? false,
  };
}
