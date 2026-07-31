import type {
  DependencyPinningSource,
  DependencyPinningSourceInput,
  ReactVersionResolutionConfig,
} from "#veryfront/transforms/esm/package-registry.ts";
import { snapshotImportMap } from "#veryfront/transforms/pipeline/cache-identity.ts";
import { captureDependencyPinningSnapshot } from "../dependency-pinning-snapshot.ts";
import type { LoadComponentOptions } from "./types.ts";

function snapshotResolutionConfig(
  config: ReactVersionResolutionConfig | null | undefined,
): ReactVersionResolutionConfig | null | undefined {
  if (!config) return config;
  const versions = config.client?.cdn?.versions;
  return Object.freeze({
    ...(config.react ? { react: Object.freeze({ ...config.react }) } : {}),
    ...(config.client
      ? {
        client: Object.freeze({
          ...config.client,
          ...(config.client.cdn
            ? {
              cdn: Object.freeze({
                ...config.client.cdn,
                ...(versions && versions !== "auto"
                  ? { versions: Object.freeze({ ...versions }) }
                  : {}),
              }),
            }
            : {}),
        }),
      }
      : {}),
  });
}

function snapshotDependencyPinningSource(
  source: DependencyPinningSourceInput,
): DependencyPinningSourceInput {
  if (source === null || typeof source !== "object") return source;
  const fs = source.fs;
  const snapshot: DependencyPinningSource = {
    ...source,
    config: snapshotResolutionConfig(source.config),
    dependencyWritebackTarget: source.dependencyWritebackTarget
      ? Object.freeze({ ...source.dependencyWritebackTarget })
      : undefined,
    ...(fs
      ? {
        fs: Object.freeze({
          readFile: fs.readFile.bind(fs),
          stat: fs.stat.bind(fs),
        }),
      }
      : {}),
  };
  return Object.freeze(snapshot);
}

/**
 * Capture every caller-owned option synchronously so no later async boundary
 * can change transform identity or behavior.
 */
export function snapshotLoadComponentOptions(
  options?: LoadComponentOptions,
): Readonly<LoadComponentOptions> | undefined {
  if (!options) return undefined;
  const dependencyPinningSource = snapshotDependencyPinningSource(
    options.dependencyPinningSource,
  );
  const dependencyPinningDependencies = captureDependencyPinningSnapshot(
    options.dependencyPinningCacheKey,
    options.dependencyPinningDependencies,
    dependencyPinningSource,
  );
  const importMap = options.importMap ? snapshotImportMap(options.importMap) : undefined;

  return Object.freeze({
    ...options,
    dependencyPinningDependencies,
    dependencyPinningSource,
    importMap,
  });
}
