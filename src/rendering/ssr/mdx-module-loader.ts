import { getCacheNamespace } from "#veryfront/utils/cache/keys/namespace.ts";
import { COMPILATION_ERROR, wrapWithContext } from "#veryfront/errors/index.ts";
// Direct import from registry.ts to avoid circular dependency through barrel
import { getLocalAdapter, runtime } from "#veryfront/platform/adapters/registry.ts";
import { rendererLogger } from "#veryfront/utils";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { MDX_RENDERER_MAX_ENTRIES, MDX_RENDERER_TTL_MS } from "#veryfront/utils/constants/cache.ts";
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";
import type { MDXModule } from "./types.ts";

const logger = rendererLogger.component("mdx");

const MDX_CACHE_CLEANUP_INTERVAL_MS = 60_000;

const mdxModuleCache = new LRUCache<string, MDXModule>({
  maxEntries: MDX_RENDERER_MAX_ENTRIES,
  ttlMs: MDX_RENDERER_TTL_MS,
  cleanupIntervalMs: MDX_CACHE_CLEANUP_INTERVAL_MS,
});

registerCache("mdx-module-cache", () => ({
  name: "mdx-module-cache",
  entries: mdxModuleCache.size,
  maxEntries: MDX_RENDERER_MAX_ENTRIES,
}));

export function clearMDXModuleCache(): void {
  mdxModuleCache.clear();
}

function validateMDXModule(module: MDXModule, context: Record<string, unknown>): void {
  const MDXContent = module.default || module.MDXContent;
  if (MDXContent) return;
  throw COMPILATION_ERROR.create({
    detail: "No default export found in MDX module",
    context,
  });
}

function getNamespacedKey(suffix: string): string {
  return `${getCacheNamespace() ?? "default"}:${suffix}`;
}

export async function loadMDXModule(modulePath: string): Promise<MDXModule> {
  try {
    const key = getNamespacedKey(modulePath);
    const cached = mdxModuleCache.get(key);
    if (cached) return cached;

    const module = (await import(modulePath)) as MDXModule;
    validateMDXModule(module, { modulePath });
    mdxModuleCache.set(key, module);

    return module;
  } catch (error) {
    throw wrapWithContext(error, `Failed to load MDX module: ${modulePath}`, { modulePath });
  }
}

export async function loadCompiledMDXModule(
  compiledCode: string,
  cacheKey: string,
): Promise<MDXModule> {
  try {
    const key = getNamespacedKey(`compiled:${cacheKey}`);
    const cached = mdxModuleCache.get(key);
    if (cached) return cached;

    if (isBrowserEnvironment()) {
      return await loadViaBlobURL(compiledCode, cacheKey, key);
    }

    return await loadViaTempFile(compiledCode, cacheKey, key);
  } catch (error) {
    throw wrapWithContext(error, "Failed to load compiled MDX module", { cacheKey });
  }
}

async function loadAndCacheModule(
  modulePath: string,
  key: string,
  context: Record<string, unknown>,
): Promise<MDXModule> {
  const module = (await import(modulePath)) as MDXModule;
  validateMDXModule(module, context);
  mdxModuleCache.set(key, module);
  return module;
}

async function loadViaTempFile(
  compiledCode: string,
  cacheKey: string,
  key: string,
): Promise<MDXModule> {
  const tempModulePath = await writeTempMDXModule(compiledCode, cacheKey);

  try {
    return await loadAndCacheModule(tempModulePath, key, {
      cacheKey,
      codePreview: compiledCode.substring(0, 200),
    });
  } finally {
    cleanupTempModule(tempModulePath).catch((error) =>
      logger.debug("Failed to cleanup temp module:", error)
    );
  }
}

async function loadViaBlobURL(
  compiledCode: string,
  cacheKey: string,
  key: string,
): Promise<MDXModule> {
  const moduleCode = wrapAsESMModule(compiledCode);
  const blob = new Blob([moduleCode], { type: "application/javascript" });
  const blobURL = URL.createObjectURL(blob);

  try {
    return await loadAndCacheModule(blobURL, key, {
      cacheKey,
      codePreview: compiledCode.substring(0, 200),
    });
  } finally {
    URL.revokeObjectURL(blobURL);
  }
}

async function writeTempMDXModule(compiledCode: string, cacheKey: string): Promise<string> {
  const tempDir = await ensureTempDir();

  const safeKey = cacheKey.replace(/[^a-zA-Z0-9-_]/g, "_").substring(0, 50);
  const uniqueId = crypto.randomUUID().slice(0, 8);
  const filename = `mdx-${safeKey}-${uniqueId}.mjs`;
  const modulePath = `${tempDir}/${filename}`;
  const moduleCode = wrapAsESMModule(compiledCode);

  const localAdapter = await getLocalAdapter();
  await localAdapter.fs.writeFile(modulePath, moduleCode);

  return modulePath;
}

function wrapAsESMModule(compiledCode: string): string {
  const imports = `
import * as React from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';

const _jsx = jsx;
const _jsxs = jsxs;
const _jsxDEV = jsx;
const _Fragment = Fragment;
`.trim();

  return `${imports}\n\n${compiledCode}`;
}

async function ensureTempDir(): Promise<string> {
  const adapter = await runtime.get();
  const { cwd } = await import("../../platform/compat/process.ts");
  const tempDir = `${cwd()}/.veryfront/temp/mdx-modules`;

  try {
    if (await adapter.fs.exists(tempDir)) return tempDir;
    await adapter.fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  } catch (error) {
    logger.warn("Failed to create temp directory, using system temp:", error);
    const os = await import("node:os");
    const path = await import("node:path");
    const systemTempDir = path.join(os.tmpdir(), `veryfront-mdx-${Date.now()}`);
    await adapter.fs.mkdir(systemTempDir, { recursive: true });
    return systemTempDir;
  }
}

async function cleanupTempModule(modulePath: string): Promise<void> {
  try {
    const adapter = await runtime.get();
    await adapter.fs.remove(modulePath);
  } catch {
    // Best-effort cleanup
  }
}
