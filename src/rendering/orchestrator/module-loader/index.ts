/**
 * Module Loader
 *
 * Loads and transforms modules for SSR, handling @/ imports and cached HTTP dependencies.
 *
 * @module rendering/orchestrator/module-loader
 */

import { parallelMap, rendererLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "@veryfront/platform/adapters/registry.ts";
import { generateHash } from "./cache.ts";
import { findLocalLibFile, findSourceFile } from "../file-resolver/index.ts";

// Re-export utilities
export { createEsmCache, createModuleCache, generateHash } from "./cache.ts";
export { fetchEsmModule, rewriteEsmPaths } from "./esm-rewriter.ts";

export interface ModuleLoaderConfig {
  projectDir: string;
  projectId?: string;
  adapter: RuntimeAdapter;
  mode: "development" | "production";
  moduleCache: Map<string, string>;
  esmCache: Map<string, string>;
}

function getModuleCacheKey(filePath: string, projectId?: string, projectDir?: string): string {
  const prefix = projectId ?? projectDir ?? "default";
  return `${prefix}:${filePath}`;
}

/**
 * Transform a module and all its @/ dependencies.
 *
 * @param filePath - Path to the module
 * @param tmpDir - Temp directory for caching
 * @param localAdapter - Local file system adapter
 * @param config - Module loader configuration
 * @param useLocalAdapter - Whether to use local adapter for reading
 * @returns Path to the transformed module file
 */
export async function transformModuleWithDeps(
  filePath: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  config: ModuleLoaderConfig,
  useLocalAdapter = false,
): Promise<string> {
  const { moduleCache, projectDir, projectId, adapter, mode } = config;
  const cacheKey = getModuleCacheKey(filePath, projectId, projectDir);

  // Check if already transformed
  if (moduleCache.has(cacheKey)) {
    return moduleCache.get(cacheKey)!;
  }

  // Use local adapter for local lib files, project adapter for user project files
  const readAdapter = useLocalAdapter ? localAdapter : adapter;
  let fileContent = await readAdapter.fs.readFile(filePath);
  // Ensure fileContent is a string (not Uint8Array)
  if (typeof fileContent !== "string") {
    fileContent = new TextDecoder().decode(fileContent as Uint8Array);
  }
  const { transformToESM } = await import("@veryfront/transforms/esm-transform.ts");

  // Find all @/ imports BEFORE transforming (transformToESM converts them to relative paths)
  // We need to resolve these first and replace them with file:// paths
  const aliasImports = [...fileContent.matchAll(/from\s+["'](@\/[^"']+)["']/g)]
    .map((m) => ({ full: m[0], path: m[1]! }));

  logger.debug("[ModuleLoader] Processing file:", {
    filePath,
    aliasImportsCount: aliasImports.length,
    aliasImports: aliasImports.map((i) => i.path),
  });

  // Transform each @/ dependency in PARALLEL and replace in original code
  // This way transformToESM won't convert them to broken relative paths

  // Step 1: Resolve all dependency paths in parallel
  const resolvedDeps = await parallelMap(aliasImports, async ({ full, path }) => {
    const relativePath = path.substring(2); // Remove @/ prefix

    let depFilePath: string | null = null;
    let isLocalLib = false;

    // Check if this is a @/lib/... import (framework utilities)
    // These are LOCAL to veryfront-renderer, not in the user's project
    if (relativePath.startsWith("lib/")) {
      depFilePath = await findLocalLibFile(relativePath, localAdapter);
      isLocalLib = true;
    } else {
      // For other @/ imports (shared/, features/, components/, etc.), look in user's project
      // Try multiple prefixes since the file could be in various locations
      depFilePath = await findSourceFile(relativePath, projectDir, adapter);
      if (!depFilePath) {
        depFilePath = await findSourceFile(`components/${relativePath}`, projectDir, adapter);
      }
    }

    return { full, path, relativePath, depFilePath, isLocalLib };
  });

  // Step 2: Transform all found dependencies in parallel
  const transformedDeps = await parallelMap(
    resolvedDeps.filter((d) => d.depFilePath !== null),
    async (dep) => {
      logger.debug("[ModuleLoader] Found dependency:", {
        path: dep.path,
        depFilePath: dep.depFilePath,
        isLocalLib: dep.isLocalLib,
      });
      const depTempPath = await transformModuleWithDeps(
        dep.depFilePath!,
        tmpDir,
        localAdapter,
        config,
        dep.isLocalLib,
      );
      return { ...dep, depTempPath };
    },
  );

  // Step 3: Apply all replacements to original code
  for (const dep of transformedDeps) {
    fileContent = fileContent.replace(dep.full, `from "file://${dep.depTempPath}"`);
    logger.debug("[ModuleLoader] Replaced import:", {
      path: dep.path,
      depTempPath: dep.depTempPath,
    });
  }

  // Log warnings for unresolved dependencies
  for (const dep of resolvedDeps.filter((d) => d.depFilePath === null)) {
    logger.warn("[ModuleLoader] Could not find dependency:", {
      path: dep.path,
      relativePath: dep.relativePath,
      projectDir,
    });
  }

  // Now transform the code (with @/ imports already replaced with file:// paths)
  const transformedCode = await transformToESM(
    fileContent,
    filePath,
    projectDir,
    adapter,
    {
      projectId: projectId ?? projectDir,
      dev: mode === "development",
      ssr: true,
    },
  );

  // Note: esm.sh URLs (like https://esm.sh/react@18.3.1/...) are kept as-is.
  // Deno natively supports HTTP imports and will fetch/cache them automatically.
  // Previous code tried to fetch and cache esm.sh locally, but this broke because
  // esm.sh modules have relative paths that only work when loaded from esm.sh.

  // Write transformed code to temp file
  const hash = await generateHash(filePath);
  const tempFilePath = `${tmpDir}/mod-${hash}.js`;

  // Ensure directory exists before writing
  try {
    await localAdapter.fs.mkdir(tmpDir, { recursive: true });
  } catch {
    // Directory might already exist, ignore errors
  }

  try {
    await localAdapter.fs.writeFile(tempFilePath, transformedCode);
  } catch (writeError) {
    logger.error("[ModuleLoader] Failed to write module:", {
      filePath,
      tempFilePath,
      error: writeError instanceof Error ? writeError.message : String(writeError),
    });
    throw writeError;
  }

  moduleCache.set(cacheKey, tempFilePath);
  return tempFilePath;
}

/**
 * Load a module by path, transforming it and its dependencies.
 *
 * @param filePath - Path to the module to load
 * @param config - Module loader configuration
 * @returns The loaded module
 */
export async function loadModule(
  filePath: string,
  config: ModuleLoaderConfig,
): Promise<any> {
  const { getProjectTmpDir } = await import("@veryfront/modules/react-loader/index.ts");
  const tmpDir = await getProjectTmpDir(config.projectId ?? config.projectDir);
  const localAdapter = await getLocalAdapter();

  // Transform the module and all its @/ dependencies
  const tempFilePath = await transformModuleWithDeps(filePath, tmpDir, localAdapter, config);

  // Import using the original temp file path
  // Use dynamic import with proper base URL resolution
  const moduleUrl = `file://${tempFilePath}?t=${Date.now()}`;

  try {
    return await import(moduleUrl);
  } catch (importError) {
    // If file:// import fails, log the error for debugging
    logger.error("[ModuleLoader] Failed to import module:", {
      filePath,
      tempFilePath,
      error: importError instanceof Error ? importError.message : String(importError),
    });
    throw importError;
  }
}
