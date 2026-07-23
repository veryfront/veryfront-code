import { computeDepsHash } from "#veryfront/cache/dependency-graph.ts";
import type { TransformOptions } from "./types.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";

export type DependencyCacheIdentity =
  | { cacheable: true; depsHash?: string }
  | { cacheable: false; error: unknown };

/**
 * Resolve the dependency component of a transform cache key. Failure is an
 * explicit uncacheable result: omitting a dependency hash would alias a failed
 * dependency scan with a transform that genuinely has no dependency reader.
 *
 * @internal
 */
export async function computeDependencyCacheIdentity(
  filePath: string,
  projectDir: string,
  readFile?: (path: string) => Promise<string>,
  dependencyHashCache?: TransformOptions["dependencyHashCache"],
  importMap?: ImportMapConfig,
  importMapFingerprint?: string,
): Promise<DependencyCacheIdentity> {
  if (!readFile) return { cacheable: true };

  try {
    return {
      cacheable: true,
      depsHash: await computeDepsHash(filePath, readFile, projectDir, dependencyHashCache, {
        importMap,
        resolutionIdentity: importMapFingerprint,
      }),
    };
  } catch (error) {
    return { cacheable: false, error };
  }
}
