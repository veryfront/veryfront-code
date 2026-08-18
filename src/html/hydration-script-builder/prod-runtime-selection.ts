import { join, resolve } from "#veryfront/compat/path/index.ts";
import { RENDER_ERROR } from "#veryfront/errors";
import { getProdHydrationModulePath } from "./prod-scripts.ts";
import { isVersionedProdHydrationModulePath } from "./prod-path.ts";

export interface ProdHydrationModuleSelectionOptions {
  fs: {
    readDir(path: string): AsyncIterable<{ name: string; isFile: boolean }>;
  };
  projectDir: string;
  buildOutDir?: string;
  releaseId?: string;
}

/** Whether the release ID names an immutable artifact set rather than local source serving. */
export function hasImmutableReleaseHydrationRuntime(
  releaseId: string | undefined,
): releaseId is string {
  return releaseId !== undefined && releaseId.length > 0 && releaseId !== "standalone-dev";
}

/**
 * Select the hydration runtime owned by the rendered artifact set.
 *
 * Non-release renders use the serving runtime. Release renders discover the
 * single content-addressed runtime baked into that immutable release.
 * Releases without any versioned runtime fall back to the serving runtime:
 * hosted release file trees carry no build output at all (the API-backed fs
 * lists the absent dist directory as empty), so failing closed here takes
 * down every hosted release render. Only ambiguity — multiple versioned
 * runtimes — and uninspectable release artifacts fail closed.
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
  let hasMultipleRuntimes = false;

  try {
    for await (const entry of options.fs.readDir(runtimeDirectory)) {
      if (!entry.isFile) continue;

      const candidate = `/_veryfront/${entry.name}`;
      if (!isVersionedProdHydrationModulePath(candidate)) continue;
      if (selectedPath !== null) {
        hasMultipleRuntimes = true;
        break;
      }
      selectedPath = candidate;
    }
  } catch {
    throw RENDER_ERROR.create({
      detail: "Release hydration runtime could not be inspected",
    });
  }

  if (hasMultipleRuntimes) {
    throw RENDER_ERROR.create({
      detail: "Release contains multiple versioned hydration runtimes",
    });
  }

  return selectedPath ?? getProdHydrationModulePath();
}
