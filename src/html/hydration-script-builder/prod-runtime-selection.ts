import { join, resolve } from "#veryfront/compat/path/index.ts";
import { RENDER_ERROR } from "#veryfront/errors";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getReadyManifestForRenderAsync } from "#veryfront/release-assets/manifest-cache.ts";
import { serverLogger } from "#veryfront/utils";
import { getProdHydrationModulePath } from "./prod-scripts.ts";
import { isVersionedProdHydrationModulePath, PROD_HYDRATION_MODULE_PATH } from "./prod-path.ts";

const FIRST_BUILDER_VERSION_REQUIRING_BAKED_RUNTIME = [0, 1, 1244] as const;
const BUILDER_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const MAX_REPORTED_SERVING_RUNTIME_FALLBACKS = 500;
const reportedServingRuntimeFallbacks = new Set<string>();
const logger = serverLogger.component("hydration-runtime-selection");

export interface ProdHydrationModuleSelectionOptions {
  fs: {
    readDir(path: string): AsyncIterable<{ name: string; isFile: boolean }>;
  };
  projectDir: string;
  buildOutDir?: string;
  releaseId?: string;
  /** Builder version from the release asset manifest when already resolved by the caller. */
  releaseBuilderVersion?: string;
}

/** Whether the release ID names an immutable artifact set rather than local source serving. */
export function hasImmutableReleaseHydrationRuntime(
  releaseId: string | undefined,
): releaseId is string {
  return releaseId !== undefined && releaseId.length > 0 && releaseId !== "standalone-dev";
}

function isPreRuntimeArtifactContract(builderVersion: string | undefined): boolean {
  const match = builderVersion?.match(BUILDER_VERSION_PATTERN);
  if (!match) return false;

  const parsed = match.slice(1).map(Number);
  for (let index = 0; index < FIRST_BUILDER_VERSION_REQUIRING_BAKED_RUNTIME.length; index++) {
    const value = parsed[index];
    const floor = FIRST_BUILDER_VERSION_REQUIRING_BAKED_RUNTIME[index];
    if (value === undefined || floor === undefined) return false;
    if (value !== floor) return value < floor;
  }
  return false;
}

function reportServingRuntimeFallback(releaseId: string, builderVersion: string): void {
  const key = `${releaseId}:${builderVersion}`;
  if (reportedServingRuntimeFallbacks.has(key)) return;

  if (reportedServingRuntimeFallbacks.size >= MAX_REPORTED_SERVING_RUNTIME_FALLBACKS) {
    const oldestKey = reportedServingRuntimeFallbacks.values().next().value;
    if (oldestKey) reportedServingRuntimeFallbacks.delete(oldestKey);
  }
  reportedServingRuntimeFallbacks.add(key);
  logger.warn("Using the serving hydration runtime for a pre-contract release", {
    releaseId,
    builderVersion,
    reason: "release-missing-hydration-runtime",
  });
}

/**
 * Select the hydration runtime owned by the rendered artifact set.
 *
 * Non-release renders use the serving runtime. Release renders discover the
 * content-addressed runtime baked into that immutable release. Pre-versioned
 * releases use their baked legacy runtime. Releases built before the runtime
 * artifact contract use the serving runtime only when no baked runtime exists.
 * Missing or ambiguous contract-era artifacts fail closed.
 */
export async function resolveProdHydrationModulePath(
  options: ProdHydrationModuleSelectionOptions,
): Promise<string> {
  if (!hasImmutableReleaseHydrationRuntime(options.releaseId)) {
    return getProdHydrationModulePath();
  }

  const configuredOutDir = options.buildOutDir || "dist";
  const runtimeDirectory = join(resolve(options.projectDir, configuredOutDir), "_veryfront");
  let selectedPath: string | null = null;
  let hasLegacyRuntime = false;
  let hasMultipleRuntimes = false;

  try {
    for await (const entry of options.fs.readDir(runtimeDirectory)) {
      if (!entry.isFile) continue;

      const candidate = `/_veryfront/${entry.name}`;
      if (candidate === PROD_HYDRATION_MODULE_PATH) {
        hasLegacyRuntime = true;
        continue;
      }
      if (!isVersionedProdHydrationModulePath(candidate)) continue;
      if (selectedPath !== null) {
        hasMultipleRuntimes = true;
        break;
      }
      selectedPath = candidate;
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw RENDER_ERROR.create({
        detail: "Release hydration runtime could not be inspected",
      });
    }
  }

  if (hasMultipleRuntimes) {
    throw RENDER_ERROR.create({
      detail: "Release contains multiple versioned hydration runtimes",
    });
  }

  if (selectedPath !== null) return selectedPath;
  if (hasLegacyRuntime) return PROD_HYDRATION_MODULE_PATH;

  const builderVersion = options.releaseBuilderVersion ??
    (await getReadyManifestForRenderAsync(options.releaseId))?.builderVersion;
  if (builderVersion && isPreRuntimeArtifactContract(builderVersion)) {
    reportServingRuntimeFallback(options.releaseId, builderVersion);
    return getProdHydrationModulePath();
  }

  throw RENDER_ERROR.create({
    detail: "Release is missing its hydration runtime",
  });
}
