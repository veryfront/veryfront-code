import { getCacheNamespace } from "@veryfront/utils/cache/keys/namespace.ts";
import { CompilationError, wrapError } from "@veryfront/errors/index.ts";
import { getAdapter } from "@veryfront/platform/adapters/index.ts";
import { getLocalAdapter } from "@veryfront/platform/adapters/registry.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import type { MDXModule } from "./types.ts";
import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import { registerCache } from "@veryfront/utils/memory/index.ts";
import { MDX_RENDERER_MAX_ENTRIES, MDX_RENDERER_TTL_MS } from "@veryfront/utils/constants/cache.ts";

// Use LRU cache with proper limits to prevent unbounded memory growth
const mdxModuleCache = new LRUCache<string, MDXModule>({
  maxEntries: MDX_RENDERER_MAX_ENTRIES,
  ttlMs: MDX_RENDERER_TTL_MS,
  cleanupIntervalMs: 60000,
});

// Register with memory profiler
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
  if (!MDXContent) {
    throw new CompilationError("No default export found in MDX module", context);
  }
}

export async function loadMDXModule(
  modulePath: string,
): Promise<MDXModule> {
  try {
    const ns = getCacheNamespace() || "default";
    const key = `${ns}:${modulePath}`;
    const cached = mdxModuleCache.get(key);
    if (cached) {
      return cached;
    }

    const module = await import(modulePath) as MDXModule;
    validateMDXModule(module, { modulePath });
    mdxModuleCache.set(key, module);

    return module;
  } catch (error) {
    throw wrapError(error, `Failed to load MDX module: ${modulePath}`, { modulePath });
  }
}

export async function loadCompiledMDXModule(
  compiledCode: string,
  cacheKey: string,
): Promise<MDXModule> {
  try {
    const ns = getCacheNamespace() || "default";
    const key = `${ns}:compiled:${cacheKey}`;
    const cached = mdxModuleCache.get(key);
    if (cached) {
      return cached;
    }

    const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

    if (isBrowser) {
      return await loadViaBlobURL(compiledCode, cacheKey, key);
    }
    return await loadViaTempFile(compiledCode, cacheKey, key);
  } catch (error) {
    throw wrapError(error, `Failed to load compiled MDX module`, { cacheKey });
  }
}

async function loadViaTempFile(
  compiledCode: string,
  cacheKey: string,
  key: string,
): Promise<MDXModule> {
  const tempModulePath = await writeTempMDXModule(compiledCode, cacheKey);

  try {
    const module = await import(tempModulePath) as MDXModule;
    validateMDXModule(module, { cacheKey, codePreview: compiledCode.substring(0, 200) });
    mdxModuleCache.set(key, module);
    return module;
  } finally {
    cleanupTempModule(tempModulePath).catch((err) =>
      logger.debug("[MDX] Failed to cleanup temp module:", err)
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
    const module = await import(blobURL) as MDXModule;
    validateMDXModule(module, { cacheKey, codePreview: compiledCode.substring(0, 200) });
    mdxModuleCache.set(key, module);
    return module;
  } finally {
    URL.revokeObjectURL(blobURL);
  }
}

async function writeTempMDXModule(
  compiledCode: string,
  cacheKey: string,
): Promise<string> {
  const tempDir = await ensureTempDir();

  const safeKey = cacheKey.replace(/[^a-zA-Z0-9-_]/g, "_").substring(0, 50);
  const uniqueId = crypto.randomUUID().slice(0, 8);
  const filename = `mdx-${safeKey}-${uniqueId}.mjs`;
  const modulePath = `${tempDir}/${filename}`;
  const moduleCode = wrapAsESMModule(compiledCode);

  // Use local adapter for temp files - always local regardless of FSAdapter
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
  const adapter = await getAdapter();
  const { cwd } = await import("../../platform/compat/process.ts"); // Import cwd helper
  const tempDir = `${cwd()}/.veryfront/temp/mdx-modules`;

  try {
    const exists = await adapter.fs.exists(tempDir);
    if (!exists) {
      await adapter.fs.mkdir(tempDir, { recursive: true });
    }
    return tempDir;
  } catch (error) {
    logger.warn("[MDX] Failed to create temp directory, using system temp:", error);
    const os = await import("node:os");
    const path = await import("node:path");
    const systemTempDir = path.join(os.tmpdir(), `veryfront-mdx-${Date.now()}`);
    await adapter.fs.mkdir(systemTempDir, { recursive: true });
    return systemTempDir;
  }
}

async function cleanupTempModule(modulePath: string): Promise<void> {
  try {
    const adapter = await getAdapter();
    await adapter.fs.remove(modulePath);
  } catch {
    // Best-effort cleanup
  }
}
