import { dirname, isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { getConfig } from "#veryfront/config";
import { createRenderer, type VeryfrontRenderer } from "#veryfront/rendering/index.ts";
import type { BuildOptions, BuildStats } from "#veryfront/server/build-types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

/** Runtime services and mutable statistics owned by one production build. */
export interface BuildContext {
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  renderer: VeryfrontRenderer;
  options: BuildOptions;
  stats: BuildStats;
}

/** Resolve the adapter, project config, renderer, and initial statistics. */
export async function initializeBuildContext(options: BuildOptions): Promise<BuildContext> {
  const normalizedOptions = normalizeBuildOptions(options);
  const adapter = await runtime.get();
  const config = await getConfig(normalizedOptions.projectDir, adapter);
  const renderer = await createRenderer({
    projectDir: normalizedOptions.projectDir,
    mode: "production",
    adapter,
  });

  return {
    adapter,
    config,
    renderer,
    options: normalizedOptions,
    stats: createEmptyBuildStats(),
  };
}

function createEmptyBuildStats(): BuildStats {
  return {
    pages: 0,
    components: 0,
    chunks: 0,
    assets: 0,
    totalSize: 0,
    duration: 0,
  };
}

/** Validate build options and resolve paths and compatibility flags. */
export function normalizeBuildOptions(options: BuildOptions): BuildOptions {
  if (!options || typeof options !== "object") throw new TypeError("options must be an object");
  if (typeof options.projectDir !== "string" || !options.projectDir.trim()) {
    throw new TypeError("projectDir must be a non-empty string");
  }

  const projectDir = resolve(options.projectDir);
  if (dirname(projectDir) === projectDir) {
    throw new TypeError("projectDir must not be a filesystem root");
  }
  const configuredOutputDir = options.outputDir ?? join(projectDir, ".veryfront", "output");
  if (typeof configuredOutputDir !== "string" || !configuredOutputDir.trim()) {
    throw new TypeError("outputDir must be a non-empty string");
  }
  const outputDir = resolve(configuredOutputDir);

  const projectFromOutput = relative(outputDir, projectDir);
  const outputContainsProject = projectFromOutput === "" ||
    (!isAbsolute(projectFromOutput) && projectFromOutput.split(/[\\/]/)[0] !== "..");
  if (outputContainsProject) {
    throw new TypeError("outputDir must not be the project directory or one of its parents");
  }

  for (
    const [name, value] of Object.entries({
      enableSplitting: options.enableSplitting,
      splitting: options.splitting,
      enableCompression: options.enableCompression,
      compress: options.compress,
      enablePrefetch: options.enablePrefetch,
      prefetch: options.prefetch,
      ssg: options.ssg,
      dryRun: options.dryRun,
    })
  ) {
    if (value !== undefined && typeof value !== "boolean") {
      throw new TypeError(`${name} must be a boolean`);
    }
  }

  const normalizePatterns = (value: string[] | undefined, name: string): string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
    const patterns = value.map((pattern) => {
      if (
        typeof pattern !== "string" || !pattern.trim() || pattern.trim() !== pattern ||
        hasUnsafeControlCharacters(pattern)
      ) {
        throw new TypeError(`${name} must contain non-empty route patterns`);
      }
      return pattern;
    });
    if (new Set(patterns).size !== patterns.length) {
      throw new TypeError(`${name} must not contain duplicate patterns`);
    }
    return patterns;
  };

  return {
    projectDir,
    outputDir,
    enableSplitting: options.enableSplitting ?? options.splitting ?? true,
    enableCompression: options.enableCompression ?? options.compress ?? true,
    enablePrefetch: options.enablePrefetch ?? options.prefetch ?? true,
    ssg: options.ssg ?? false,
    include: normalizePatterns(options.include, "include"),
    exclude: normalizePatterns(options.exclude, "exclude"),
    dryRun: options.dryRun ?? false,
  };
}
