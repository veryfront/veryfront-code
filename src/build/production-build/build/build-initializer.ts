import { join } from "#veryfront/platform/compat/path/index.ts";
// Direct import from registry.ts to avoid circular dependency through barrel
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { getConfig } from "#veryfront/config";
import { createRenderer, type VeryfrontRenderer } from "#veryfront/rendering/index.ts";
import type { BuildOptions, BuildStats } from "#veryfront/server/build-types.ts";
// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

export interface BuildContext {
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  renderer: VeryfrontRenderer;
  options: BuildOptions;
  stats: BuildStats;
}

export async function initializeBuildContext(options: BuildOptions): Promise<BuildContext> {
  const adapter = await runtime.get();
  const config = await getConfig(options.projectDir, adapter);
  const renderer = await createRenderer({
    projectDir: options.projectDir,
    mode: "production",
    adapter,
  });

  return {
    adapter,
    config,
    renderer,
    options,
    stats: {
      pages: 0,
      components: 0,
      chunks: 0,
      assets: 0,
      totalSize: 0,
      duration: 0,
    },
  };
}

export function normalizeBuildOptions(options: BuildOptions): BuildOptions {
  const outputDir = options.outputDir ?? join(options.projectDir, ".veryfront", "output");

  return {
    projectDir: options.projectDir,
    outputDir,
    enableSplitting: options.enableSplitting ?? true,
    enableCompression: options.enableCompression ?? true,
    enablePrefetch: options.enablePrefetch ?? true,
    ssg: options.ssg ?? true,
    include: options.include,
    exclude: options.exclude,
    dryRun: options.dryRun ?? false,
  };
}
