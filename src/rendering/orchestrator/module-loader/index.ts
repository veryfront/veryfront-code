/****
 * Module Loader
 *
 * Loads and transforms modules for SSR, handling local imports (@/ alias and relative)
 * and cached HTTP dependencies.
 *
 * @module rendering/orchestrator/module-loader
 */

import { parallelMap, rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { findSourceFile } from "../file-resolver/index.ts";
import { transformModule } from "#veryfront/bundler/jit-bundler.ts";
import { getProjectTmpDir } from "#veryfront/modules/react-loader/index.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { dirname, join, normalize } from "#veryfront/platform/compat/path/index.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import {
  getModulePathCache,
  lookupMdxEsmCache,
  saveModulePathCache,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";

// Re-export utilities
export { createEsmCache, createModuleCache, generateHash } from "./cache.ts";
export { fetchEsmModule, rewriteEsmPaths } from "./esm-rewriter.ts";

/** Maximum number of directories to track to prevent memory leaks */
const MAX_CREATED_DIRS = 5000;

/** Cache for created directories to avoid repeated mkdir calls (LRU-style) */
const createdDirs = new Set<string>();

/** In-memory LRU cache for transformed code */
const transformCache = new LRUCache<string, string>({ maxEntries: 1000 });

/** Prune oldest entries when cache exceeds limit */
function pruneCreatedDirs(): void {
  if (createdDirs.size <= MAX_CREATED_DIRS) return;

  const toDelete = createdDirs.size - MAX_CREATED_DIRS;
  let deleted = 0;

  for (const dir of createdDirs) {
    if (deleted >= toDelete) break;
    createdDirs.delete(dir);
    deleted++;
  }
}

function getModuleCacheKey(
  filePath: string,
  projectId?: string,
  projectDir?: string,
  contentSourceId?: string,
): string {
  const base = projectId ?? projectDir ?? "default";
  const source = contentSourceId ?? "default";
  return `${base}:${source}:${filePath}`;
}

function decodeFileContent(fileContent: string | Uint8Array): string {
  if (typeof fileContent === "string") return fileContent;
  return new TextDecoder().decode(fileContent);
}

async function ensureDir(adapter: RuntimeAdapter, dir: string): Promise<void> {
  if (createdDirs.has(dir)) return;

  try {
    await adapter.fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory might already exist, ignore errors
  } finally {
    createdDirs.add(dir);
    pruneCreatedDirs();
  }
}

type AliasImport = { full: string; path: string };
type RelativeImport = { full: string; path: string; fromDir: string };
type ResolvedDep = {
  full: string;
  path: string;
  relativePath: string;
  depFilePath: string | null;
  isLocalLib: boolean;
};

async function resolveAliasImport(
  imp: AliasImport,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<ResolvedDep> {
  const relativePath = imp.path.substring(2); // Remove @/ prefix

  const depFilePath = (await findSourceFile(relativePath, projectDir, adapter)) ??
    (await findSourceFile(`components/${relativePath}`, projectDir, adapter));

  return { ...imp, relativePath, depFilePath, isLocalLib: false };
}

async function resolveRelativeImport(
  imp: RelativeImport,
  adapter: RuntimeAdapter,
): Promise<ResolvedDep> {
  // Resolve the path relative to the file's directory and normalize to resolve ..
  const basePath = normalize(join(imp.fromDir, imp.path));

  logger.debug("[ModuleLoader] Resolving relative import:", {
    path: imp.path,
    fromDir: imp.fromDir,
    basePath,
  });

  // Try to find the source file with various extensions
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
  let depFilePath: string | null = null;

  // First try the exact path (in case it already has an extension)
  if (await adapter.fs.exists(basePath)) {
    const stat = await adapter.fs.stat(basePath);
    if (!stat.isDirectory) {
      depFilePath = basePath;
    }
  }

  // Try with extensions
  if (!depFilePath) {
    for (const ext of extensions) {
      const pathWithExt = basePath + ext;
      if (await adapter.fs.exists(pathWithExt)) {
        depFilePath = pathWithExt;
        break;
      }
    }
  }

  // Try index files if path is a directory
  if (!depFilePath) {
    for (const ext of extensions) {
      const indexPath = join(basePath, `index${ext}`);
      if (await adapter.fs.exists(indexPath)) {
        depFilePath = indexPath;
        break;
      }
    }
  }

  return {
    full: imp.full,
    path: imp.path,
    relativePath: imp.path,
    depFilePath,
    isLocalLib: false,
  };
}

/**
 * Transform a module and all its local dependencies (@/ alias and relative imports).
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
  const { moduleCache, projectDir, projectId, contentSourceId, adapter, mode: _mode } = config;
  const cacheKey = getModuleCacheKey(filePath, projectId, projectDir, contentSourceId);

  const cachedPath = moduleCache.get(cacheKey);
  if (cachedPath) return cachedPath;

  if (projectId && contentSourceId) {
    const baseCacheDir = getMdxEsmCacheDir();
    const projectKey = encodeURIComponent(projectId);
    const sourceKey = encodeURIComponent(contentSourceId);
    const mdxCacheDir = join(baseCacheDir, projectKey, sourceKey);

    const mdxCacheResult = await lookupMdxEsmCache(filePath, mdxCacheDir, projectDir);
    if (mdxCacheResult.status === "hit") {
      moduleCache.set(cacheKey, mdxCacheResult.path);
      return mdxCacheResult.path;
    }

    if (mdxCacheResult.status === "corrupted") {
      logger.warn("[ModuleLoader] MDX-ESM cache corrupted, will re-transform", {
        filePath,
        reason: mdxCacheResult.reason,
      });
    }
  }

  const readAdapter = useLocalAdapter ? localAdapter : adapter;
  let fileContent = decodeFileContent(await readAdapter.fs.readFile(filePath));

  const fileDir = dirname(filePath);

  // Match @/ alias imports
  const aliasImports: AliasImport[] = [...fileContent.matchAll(/from\s+["'](@\/[^"']+)["']/g)].map(
    (m) => ({ full: m[0], path: m[1]! }),
  );

  // Match relative imports (./ and ../) - exclude npm:, http://, https://, file://
  const relativeImports: RelativeImport[] = [
    ...fileContent.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g),
  ]
    .map((m) => ({ full: m[0], path: m[1]!, fromDir: fileDir }))
    // Filter out already-transformed file:// imports
    .filter((imp) => !imp.path.includes("file://"));

  logger.debug("[ModuleLoader] Processing file:", {
    filePath,
    aliasImportsCount: aliasImports.length,
    relativeImportsCount: relativeImports.length,
    aliasImports: aliasImports.map((i) => i.path),
    relativeImports: relativeImports.map((i) => i.path),
  });

  // Resolve alias imports
  const resolvedAliasDeps = await parallelMap(
    aliasImports,
    (imp) => resolveAliasImport(imp, projectDir, adapter),
  );

  // Resolve relative imports
  const resolvedRelativeDeps = await parallelMap(
    relativeImports,
    (imp) => resolveRelativeImport(imp, adapter),
  );

  // Combine all resolved dependencies
  const resolvedDeps = [...resolvedAliasDeps, ...resolvedRelativeDeps];

  const transformedDeps = await parallelMap(
    resolvedDeps.filter((d) => d.depFilePath),
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

  for (const dep of transformedDeps) {
    fileContent = fileContent.replace(dep.full, `from "file://${dep.depTempPath}"`);
    logger.debug("[ModuleLoader] Replaced import:", {
      path: dep.path,
      depTempPath: dep.depTempPath,
    });
  }

  for (const dep of resolvedDeps) {
    if (dep.depFilePath) continue;
    logger.warn("[ModuleLoader] Could not find dependency:", {
      path: dep.path,
      relativePath: dep.relativePath,
      projectDir,
    });
  }

  const contentHash = hashCodeHex(fileContent);
  const transformCacheKey = `${projectDir}:${filePath}:${contentHash}`;

  // Check in-memory cache first
  let transformedCode = transformCache.get(transformCacheKey);
  if (!transformedCode) {
    logger.debug("[ModuleLoader] Transform cache miss, transforming", { filePath });
    transformedCode = await transformModule(fileContent, filePath, {
      projectDir,
      reactVersion: config.reactVersion,
      ssr: true,
    });
    transformCache.set(transformCacheKey, transformedCode);
  }
  const transformedHash = hashCodeHex(transformedCode).slice(0, 8);

  const relativePath = filePath.startsWith(projectDir)
    ? filePath.slice(projectDir.length).replace(/^\/+/, "")
    : filePath.replace(/^\/+/, "");

  const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, `.${transformedHash}.js`);
  const tempFilePath = join(tmpDir, jsPath);

  const tempDir = tempFilePath.substring(0, tempFilePath.lastIndexOf("/"));
  await ensureDir(localAdapter, tempDir);

  try {
    await localAdapter.fs.writeFile(tempFilePath, transformedCode);
  } catch (error) {
    logger.error("[ModuleLoader] Failed to write module:", {
      filePath,
      tempFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (contentSourceId) {
    const normalizedPath = `_vf_modules/${relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js")}`;
    const mdxCacheKey = `v${VERSION}:${normalizedPath}`;
    const cache = await getModulePathCache(tmpDir);
    cache.set(mdxCacheKey, tempFilePath);

    saveModulePathCache(tmpDir).catch((err) => {
      logger.debug("[ModuleLoader] Failed to save module cache", { error: String(err) });
    });

    logger.debug("[ModuleLoader] Registered module in MDX-ESM cache", {
      file: filePath.slice(-40),
      mdxCacheKey,
      tempFilePath: tempFilePath.slice(-60),
    });
  }

  moduleCache.set(cacheKey, tempFilePath);
  return tempFilePath;
}

export interface ModuleLoaderConfig {
  projectDir: string;
  projectId?: string;
  contentSourceId?: string;
  adapter: RuntimeAdapter;
  mode: "development" | "production";
  moduleCache: Map<string, string>;
  esmCache: Map<string, string>;
  /** React version for transforms (from project config) */
  reactVersion?: string;
}

/**
 * Get the cache directory for module transforms.
 * Uses MDX-ESM cache when contentSourceId is available, otherwise falls back to project tmp dir.
 * This ensures modules are shared between orchestrator and MDX loader to prevent duplicate contexts.
 */
async function getModuleCacheDir(config: ModuleLoaderConfig): Promise<string> {
  const { projectId, contentSourceId, projectDir } = config;

  if (projectId && contentSourceId) {
    const baseCacheDir = getMdxEsmCacheDir();
    const projectKey = encodeURIComponent(projectId);
    const sourceKey = encodeURIComponent(contentSourceId);
    const cacheDir = join(baseCacheDir, projectKey, sourceKey);

    const { createFileSystem } = await import("#veryfront/platform/compat/fs.ts");
    await createFileSystem().mkdir(cacheDir, { recursive: true });

    return cacheDir;
  }

  return getProjectTmpDir(projectId ?? projectDir);
}

/**
 * Load a module by path, transforming it and its dependencies.
 *
 * @param filePath - Path to the module to load
 * @param config - Module loader configuration
 * @returns The loaded module
 */
export async function loadModule(filePath: string, config: ModuleLoaderConfig): Promise<any> {
  const tmpDir = await getModuleCacheDir(config);
  const localAdapter = await getLocalAdapter();

  const tempFilePath = await transformModuleWithDeps(filePath, tmpDir, localAdapter, config);
  const moduleUrl = `file://${tempFilePath}?t=${Date.now()}`;

  try {
    return await import(moduleUrl);
  } catch (error) {
    logger.error("[ModuleLoader] Failed to import module:", {
      filePath,
      tempFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
