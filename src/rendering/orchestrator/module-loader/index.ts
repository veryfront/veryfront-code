/**
 * Module Loader
 *
 * Loads and transforms modules for SSR, handling @/ imports and esm.sh dependencies.
 *
 * @module rendering/orchestrator/module-loader
 */

import { rendererLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "@veryfront/platform/adapters/registry.ts";
import { generateHash } from "./cache.ts";
import { fetchEsmModule } from "./esm-rewriter.ts";
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
  const { moduleCache, esmCache, projectDir, projectId, adapter, mode } = config;

  // Check if already transformed
  if (moduleCache.has(filePath)) {
    return moduleCache.get(filePath)!;
  }

  // Use local adapter for local lib files, project adapter for user project files
  const readAdapter = useLocalAdapter ? localAdapter : adapter;
  const fileContent = await readAdapter.fs.readFile(filePath);
  const { transformToESM } = await import("@veryfront/transforms/esm-transform.ts");

  let transformedCode = await transformToESM(
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

  // Find all @/ imports and transform them recursively
  const aliasImports = [...transformedCode.matchAll(/from\s+["'](@\/[^"']+)["']/g)]
    .map((m) => ({ full: m[0], path: m[1]! }));

  // Find and transform esm.sh URLs - fetch them and cache locally
  // Dynamic import from file:// URLs doesn't support https:// imports
  const esmImports = [...transformedCode.matchAll(/from\s+(["'])(https:\/\/esm\.sh\/[^"']+)\1/g)]
    .map((m) => ({ full: m[0], url: m[2]! }));

  // Fetch and cache all esm.sh dependencies in parallel
  if (esmImports.length > 0) {
    const cachedPaths = await Promise.all(
      esmImports.map(({ url }) => fetchEsmModule(url, tmpDir, localAdapter, esmCache)),
    );
    for (let i = 0; i < esmImports.length; i++) {
      transformedCode = transformedCode.replace(
        esmImports[i]!.full,
        `from "file://${cachedPaths[i]}"`,
      );
    }
  }

  // Transform each @/ dependency
  for (const { full, path } of aliasImports) {
    const relativePath = path.substring(2); // Remove @/ prefix

    let depFilePath: string | null = null;

    // Check if this is a @/lib/... import (framework utilities)
    // These are LOCAL to veryfront-private, not in the user's project
    let isLocalLib = false;
    if (relativePath.startsWith("lib/")) {
      depFilePath = await findLocalLibFile(relativePath, localAdapter);
      isLocalLib = true;
    } else {
      // For other @/ imports (shared/, etc.), look in user's project
      depFilePath = await findSourceFile(`components/${relativePath}`, projectDir, adapter);
    }

    if (depFilePath) {
      const depTempPath = await transformModuleWithDeps(
        depFilePath,
        tmpDir,
        localAdapter,
        config,
        isLocalLib,
      );
      transformedCode = transformedCode.replace(full, `from "file://${depTempPath}"`);
    } else {
      logger.warn("[ModuleLoader] Could not find dependency:", path);
    }
  }

  // Write transformed code to temp file
  const hash = await generateHash(filePath);
  const tempFilePath = `${tmpDir}/mod-${hash}.js`;
  await localAdapter.fs.writeFile(tempFilePath, transformedCode);

  moduleCache.set(filePath, tempFilePath);
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
