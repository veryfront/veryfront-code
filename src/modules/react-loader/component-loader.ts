/**
 * Component Loader
 *
 * Loads React components from source code using the JIT bundler.
 * Components are transformed with esbuild and cached for efficient SSR.
 *
 * Architecture:
 * - Uses transformModule from jit-bundler for fast esbuild-based transforms
 * - Handles @/ alias and relative imports by recursively transforming dependencies
 * - Local-only caching (no distributed cache needed)
 *
 * @module modules/react-loader/component-loader
 */

import type * as React from "react";
import { dirname, join, normalize } from "#veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import type { LoadComponentOptions } from "./types.ts";
import { transformModule } from "#veryfront/bundler/jit-bundler.ts";
import { addDepsToEsmShUrls } from "#veryfront/transforms/esm/react-imports.ts";
import { cacheHttpImportsToLocal } from "#veryfront/transforms/esm/http-cache.ts";
import { getProjectTmpDir } from "./temp-directory.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { extractComponent } from "./extract-component.ts";
import { findSourceFile } from "#veryfront/rendering/orchestrator/file-resolver/index.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { _testExports as ssrVfModulesExports } from "#veryfront/transforms/pipeline/stages/ssr-vf-modules.ts";
import { resolveVeryfrontModuleUrl } from "#veryfront/transforms/veryfront-module-urls.ts";
import { replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

const { findVfModuleImports, resolveFrameworkFile } = ssrVfModulesExports;

/**
 * Transform framework source code with esbuild and React import rewriting.
 */
async function transformFrameworkSource(
  content: string,
  sourcePath: string,
  reactVersion: string,
  projectDir: string,
): Promise<string> {
  const { transform } = await import("esbuild");
  const { getReactImportMap } = await import("#veryfront/transforms/import-rewriter/url-builder.ts");
  const { loadImportMap } = await import("#veryfront/modules/import-map/index.ts");

  const ext = sourcePath.match(/\.(tsx?|jsx?)$/)?.[1] ?? "tsx";
  let loader: "tsx" | "ts" | "jsx" | "js" = "js";
  if (ext === "tsx") loader = "tsx";
  else if (ext === "ts") loader = "ts";
  else if (ext === "jsx") loader = "jsx";

  const result = await transform(content, {
    loader,
    jsx: "automatic",
    jsxImportSource: "react",
    format: "esm",
    target: "es2022",
  });

  let transformed = result.code;

  // Rewrite React imports to CDN URLs
  const reactImportMap = getReactImportMap(reactVersion);
  transformed = await replaceSpecifiers(transformed, (specifier) => {
    return reactImportMap[specifier] ?? null;
  });

  // Cache HTTP imports
  const importMap = await loadImportMap(projectDir);
  const cacheResult = await cacheHttpImportsToLocal(transformed, {
    cacheDir: getHttpBundleCacheDir(),
    importMap,
    reactVersion,
  });

  return cacheResult.code;
}

/**
 * Resolve and transform /_vf_modules/_veryfront/ imports to file:// paths.
 */
async function resolveVfModuleImports(
  code: string,
  projectDir: string,
  reactVersion: string,
): Promise<string> {
  const vfModuleImports = findVfModuleImports(code);
  if (vfModuleImports.length === 0) return code;

  const fs = createFileSystem();
  const replacements = new Map<string, string>();

  for (const vfModulePath of vfModuleImports) {
    try {
      const resolved = await resolveFrameworkFile(vfModulePath, fs);
      if (!resolved) continue;

      const transformed = await transformFrameworkSource(
        resolved.content,
        resolved.sourcePath,
        reactVersion,
        projectDir,
      );

      // Cache the transformed code
      const cacheDir = getHttpBundleCacheDir();
      const contentHash = hashCodeHex(transformed).slice(0, 12);
      const pathHash = hashCodeHex(vfModulePath).slice(0, 8);
      const fileName = `vfmod-${pathHash}-${contentHash}.mjs`;
      const cachePath = join(cacheDir, "framework", fileName);

      const localAdapter = await getLocalAdapter();
      await ensureDir(localAdapter, join(cacheDir, "framework"));
      await localAdapter.fs.writeFile(cachePath, transformed);

      replacements.set(vfModulePath, `file://${cachePath}`);
    } catch (error) {
      logger.warn("[ComponentLoader] Failed to transform vf module", {
        vfModulePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (replacements.size === 0) return code;

  return replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}

/** In-memory LRU cache for transformed component paths */
const transformPathCache = new LRUCache<string, string>({ maxEntries: 2000 });

/** In-memory LRU cache for transformed code */
const transformCodeCache = new LRUCache<string, string>({ maxEntries: 2000 });

/** Cache for created directories to avoid repeated mkdir calls */
const createdDirs = new Set<string>();
const MAX_CREATED_DIRS = 5000;

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

async function ensureDir(adapter: RuntimeAdapter, dir: string): Promise<void> {
  if (createdDirs.has(dir)) return;
  try {
    await adapter.fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory might already exist
  } finally {
    createdDirs.add(dir);
    pruneCreatedDirs();
  }
}

function getTransformCacheKey(
  filePath: string,
  contentHash: string,
  projectId: string,
): string {
  return `${projectId}:${filePath}:${contentHash}`;
}

type AliasImport = { full: string; path: string };
type RelativeImport = { full: string; path: string; fromDir: string };
type ResolvedDep = {
  full: string;
  path: string;
  relativePath: string;
  depFilePath: string | null;
};

async function resolveAliasImport(
  imp: AliasImport,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<ResolvedDep> {
  const relativePath = imp.path.substring(2); // Remove @/ prefix
  const depFilePath = (await findSourceFile(relativePath, projectDir, adapter)) ??
    (await findSourceFile(`components/${relativePath}`, projectDir, adapter));
  return { ...imp, relativePath, depFilePath };
}

async function resolveRelativeImport(
  imp: RelativeImport,
  adapter: RuntimeAdapter,
): Promise<ResolvedDep> {
  const basePath = normalize(join(imp.fromDir, imp.path));
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
  let depFilePath: string | null = null;

  // Try exact path
  if (await adapter.fs.exists(basePath)) {
    const stat = await adapter.fs.stat(basePath);
    if (!stat.isDirectory) depFilePath = basePath;
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

  // Try index files
  if (!depFilePath) {
    for (const ext of extensions) {
      const indexPath = join(basePath, `index${ext}`);
      if (await adapter.fs.exists(indexPath)) {
        depFilePath = indexPath;
        break;
      }
    }
  }

  return { full: imp.full, path: imp.path, relativePath: imp.path, depFilePath };
}

/**
 * Transform a component and all its local dependencies.
 */
async function transformComponentWithDeps(
  source: string,
  filePath: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  projectDir: string,
  projectId: string,
  adapter: RuntimeAdapter,
  reactVersion?: string,
  depth = 0,
): Promise<string> {
  if (depth > 20) {
    throw new Error(`Max transform depth exceeded for ${filePath}`);
  }

  const contentHash = hashCodeHex(source);
  const cacheKey = getTransformCacheKey(filePath, contentHash, projectId);

  // Check path cache
  const cachedPath = transformPathCache.get(cacheKey);
  if (cachedPath) {
    if (await localAdapter.fs.exists(cachedPath)) {
      return cachedPath;
    }
    transformPathCache.delete(cacheKey);
  }

  let fileContent = source;
  const fileDir = dirname(filePath);

  // Match @/ alias imports
  const aliasImports: AliasImport[] = [...fileContent.matchAll(/from\s+["'](@\/[^"']+)["']/g)].map(
    (m) => ({ full: m[0], path: m[1]! }),
  );

  // Match relative imports
  const relativeImports: RelativeImport[] = [
    ...fileContent.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g),
  ]
    .map((m) => ({ full: m[0], path: m[1]!, fromDir: fileDir }))
    .filter((imp) => !imp.path.includes("file://"));

  // Resolve dependencies
  const resolvedAliasDeps = await Promise.all(
    aliasImports.map((imp) => resolveAliasImport(imp, projectDir, adapter)),
  );
  const resolvedRelativeDeps = await Promise.all(
    relativeImports.map((imp) => resolveRelativeImport(imp, adapter)),
  );
  const resolvedDeps = [...resolvedAliasDeps, ...resolvedRelativeDeps];

  // Transform dependencies recursively
  const transformedDeps = await Promise.all(
    resolvedDeps
      .filter((d) => d.depFilePath)
      .map(async (dep) => {
        const depSource = await adapter.fs.readFile(dep.depFilePath!);
        const depTempPath = await transformComponentWithDeps(
          depSource,
          dep.depFilePath!,
          tmpDir,
          localAdapter,
          projectDir,
          projectId,
          adapter,
          reactVersion,
          depth + 1,
        );
        return { ...dep, depTempPath };
      }),
  );

  // Rewrite imports to file:// paths
  for (const dep of transformedDeps) {
    fileContent = fileContent.replace(dep.full, `from "file://${dep.depTempPath}"`);
  }

  // Check transform code cache
  const transformCodeKey = `${projectDir}:${filePath}:${hashCodeHex(fileContent)}`;
  let transformedCode = transformCodeCache.get(transformCodeKey);

  if (!transformedCode) {
    logger.debug("[ComponentLoader] Transform cache miss, transforming", { filePath });
    transformedCode = await transformModule(fileContent, filePath, {
      projectDir,
      reactVersion,
      ssr: true,
    });

    // Rewrite veryfront/* bare imports to /_vf_modules/_veryfront/...?ssr=true URLs
    transformedCode = await replaceSpecifiers(transformedCode, (specifier) => {
      if (specifier.startsWith("veryfront/") || specifier === "veryfront") {
        const url = resolveVeryfrontModuleUrl(specifier);
        if (url) return `${url}?ssr=true`;
      }
      return null;
    });

    // Resolve /_vf_modules/_veryfront/ imports to file:// paths
    transformedCode = await resolveVfModuleImports(
      transformedCode,
      projectDir,
      reactVersion ?? REACT_DEFAULT_VERSION,
    );

    // Normalize esm.sh URLs to include external=react,react-dom to prevent multiple React instances
    transformedCode = await addDepsToEsmShUrls(transformedCode, true, reactVersion);
    // Cache HTTP imports to local file:// paths to ensure consistent React instances
    const cacheResult = await cacheHttpImportsToLocal(transformedCode, {
      cacheDir: getHttpBundleCacheDir(),
      importMap: { imports: {}, scopes: {} },
      reactVersion,
    });
    transformedCode = cacheResult.code;
    transformCodeCache.set(transformCodeKey, transformedCode);
  }

  const transformedHash = hashCodeHex(transformedCode).slice(0, 8);
  const relativePath = filePath.startsWith(projectDir)
    ? filePath.slice(projectDir.length).replace(/^\/+/, "")
    : filePath.replace(/^\/+/, "");

  const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, `.${transformedHash}.js`);
  const tempFilePath = join(tmpDir, jsPath);

  const tempDir = tempFilePath.substring(0, tempFilePath.lastIndexOf("/"));
  await ensureDir(localAdapter, tempDir);

  await localAdapter.fs.writeFile(tempFilePath, transformedCode);

  transformPathCache.set(cacheKey, tempFilePath);
  return tempFilePath;
}

/**
 * Load a React component from source code.
 *
 * Uses the JIT bundler's transformModule for fast esbuild-based transforms.
 * Handles @/ alias and relative imports by recursively transforming dependencies.
 *
 * @param source - Component source code
 * @param filePath - Path to the component file
 * @param projectDir - Project root directory
 * @param adapter - Runtime adapter for file system access
 * @param options - Optional loader configuration
 * @returns The loaded React component
 */
export function loadComponentFromSource(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
): Promise<React.ComponentType<Record<string, unknown>>> {
  const fileName = filePath.split("/").pop() ?? filePath;
  const projectId = options?.projectId ?? projectDir;

  return withSpan(
    "modules.react.loadComponentFromSource",
    async () => {
      const localAdapter = await getLocalAdapter();
      const tmpDir = await getProjectTmpDir(projectId);

      const tempFilePath = await transformComponentWithDeps(
        source,
        filePath,
        tmpDir,
        localAdapter,
        projectDir,
        projectId,
        adapter,
        options?.reactVersion,
      );

      const moduleUrl = `file://${tempFilePath}?t=${Date.now()}`;

      try {
        const mod = await import(moduleUrl);
        return extractComponent(mod, filePath);
      } catch (error) {
        logger.error("[ComponentLoader] Failed to import component:", {
          filePath,
          tempFilePath,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    {
      "react.file": fileName,
      "react.projectDir": projectDir,
      "react.sourceLength": source.length,
    },
  );
}

/**
 * Clear the component transform caches.
 * Used for testing and development reloads.
 */
export function clearComponentTransformCaches(): void {
  transformPathCache.clear();
  transformCodeCache.clear();
  createdDirs.clear();
}
