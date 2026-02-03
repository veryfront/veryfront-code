/**
 * Bundle Executor - Executes JIT bundles in SSR context.
 */

import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { Span } from "@opentelemetry/api";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { joinPath } from "#veryfront/utils/path-utils.ts";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";

export interface BundleModule {
  default?: unknown;
  [key: string]: unknown;
}

export interface ExecuteOptions {
  projectId: string;
  globals?: Record<string, unknown>;
  timeoutMs?: number;
}

const moduleCache = new Map<string, BundleModule>();
const MAX_CACHE_SIZE = 100;

function getBundleFilename(cacheKey: string): string {
  const safeKey = cacheKey.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 50);
  const hash = simpleHash(cacheKey);
  return `bundle-${safeKey}-${hash}.mjs`;
}

function getBundleDir(): string {
  return joinPath(getHttpBundleCacheDir(), "jit-bundles");
}

function getBundlePath(cacheKey: string): string {
  return joinPath(getBundleDir(), getBundleFilename(cacheKey));
}

async function removeBundleFile(cacheKey: string): Promise<void> {
  const bundlePath = getBundlePath(cacheKey);
  try {
    await remove(bundlePath);
  } catch {
    // Ignore errors
  }
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Execute a bundled JavaScript module and return its exports.
 */
export async function executeBundle(
  code: string,
  cacheKey: string,
  options: ExecuteOptions,
): Promise<BundleModule> {
  const { projectId, globals: _globals = {}, timeoutMs = 10000 } = options;

  return withSpan(
    "bundler.execute",
    async (span?: Span) => {
      span?.setAttributes({
        "project.id": projectId,
        "bundle.size": code.length,
        "cache.key": cacheKey,
      });

      // Check cache
      const cached = moduleCache.get(cacheKey);
      if (cached) {
        span?.setAttribute("cache.hit", true);
        return cached;
      }

      span?.setAttribute("cache.hit", false);

      const bundleDir = getBundleDir();
      const bundleFilename = getBundleFilename(cacheKey);
      const bundlePath = joinPath(bundleDir, bundleFilename);
      const bundleUrl = `file://${bundlePath}`;

      try {
        await mkdir(bundleDir, { recursive: true });
        await writeTextFile(bundlePath, code);
        span?.setAttribute("bundle.path", bundlePath);

        const importPromise = import(bundleUrl);
        let timeoutId: number | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`Bundle execution timed out after ${timeoutMs}ms`)),
            timeoutMs,
          ) as unknown as number;
        });

        try {
          const module = await Promise.race([importPromise, timeoutPromise]) as BundleModule;
          if (timeoutId !== undefined) clearTimeout(timeoutId);

          if (moduleCache.size >= MAX_CACHE_SIZE) {
            const firstKey = moduleCache.keys().next().value as string;
            moduleCache.delete(firstKey);
            void removeBundleFile(firstKey);
          }

          moduleCache.set(cacheKey, module);

          return module;
        } catch (error) {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          throw error;
        }
      } catch (error) {
        span?.setAttribute("error", true);
        span?.setAttribute("error.message", String(error));

        const errorMessage = String(error);
        if (isBrowserGlobalError(errorMessage)) {
          const enhancedError = new Error(
            `SSR Error: Browser globals accessed during server-side rendering. ` +
              `Add "use client" directive or use dynamic imports. Original: ${errorMessage}`,
          );
          (enhancedError as Error & { cause?: unknown }).cause = error;
          throw enhancedError;
        }

        throw error;
      }
    },
    { "bundler.operation": "execute" },
  );
}

export interface GeneratedMetadata {
  title?: string;
  description?: string;
  meta?: Array<{ name: string; content: string }>;
  [key: string]: unknown;
}

export interface BundleRenderExports {
  Component?: unknown;
  React?: typeof import("react");
  renderToString?: (element: unknown) => string;
  renderToReadableStream?: (element: unknown, options?: unknown) => Promise<ReadableStream>;
  generateMetadata?: (
    params?: Record<string, unknown>,
  ) => Promise<GeneratedMetadata> | GeneratedMetadata;
  headings?: Array<{ id: string; text: string; level: number }>;
  pages?: Record<string, unknown>;
  layouts?: Record<string, unknown>;
  AppComponent?: unknown;
  module: BundleModule;
}

/**
 * Execute a bundle and extract the component and shared React.
 */
export async function executeBundleForRender(
  code: string,
  cacheKey: string,
  options: ExecuteOptions,
): Promise<BundleRenderExports> {
  const module = await executeBundle(code, cacheKey, options);

  const result: BundleRenderExports = { module };

  if (module.default !== undefined) result.Component = module.default;
  if (module.React && typeof module.React === "object") {
    result.React = module.React as typeof import("react");
  }
  if (typeof module.renderToString === "function") {
    result.renderToString = module.renderToString as (element: unknown) => string;
  }
  if (typeof module.renderToReadableStream === "function") {
    result.renderToReadableStream = module.renderToReadableStream as (
      element: unknown,
      options?: unknown,
    ) => Promise<ReadableStream>;
  }
  if (typeof module.generateMetadata === "function") {
    result.generateMetadata = module.generateMetadata as BundleRenderExports["generateMetadata"];
  }
  if (Array.isArray(module.headings)) {
    result.headings = module.headings as BundleRenderExports["headings"];
  }
  if (module.__pages && typeof module.__pages === "object") {
    result.pages = module.__pages as Record<string, unknown>;
  }
  if (module.__layouts && typeof module.__layouts === "object") {
    result.layouts = module.__layouts as Record<string, unknown>;
  }
  if (module.__AppComponent !== undefined && module.__AppComponent !== null) {
    result.AppComponent = module.__AppComponent;
  }

  return result;
}

export function clearModuleCache(cacheKey: string): boolean {
  const deleted = moduleCache.delete(cacheKey);
  if (deleted) {
    void removeBundleFile(cacheKey);
  }
  return deleted;
}

export function clearProjectModules(projectId: string): number {
  let count = 0;
  for (const key of moduleCache.keys()) {
    if (key.startsWith(`${projectId}:`)) {
      moduleCache.delete(key);
      void removeBundleFile(key);
      count++;
    }
  }
  return count;
}

export function clearAllModules(): void {
  for (const key of moduleCache.keys()) {
    void removeBundleFile(key);
  }
  moduleCache.clear();
}

export function getModuleCacheStats(): { size: number; maxSize: number } {
  return {
    size: moduleCache.size,
    maxSize: MAX_CACHE_SIZE,
  };
}

function isBrowserGlobalError(errorMessage: string): boolean {
  const browserGlobalPatterns = [
    /Cannot use 'in' operator.*undefined/i,
    /Cannot read propert.*of (undefined|null)/i,
    /document is not defined/i,
    /window is not defined/i,
    /navigator is not defined/i,
    /localStorage is not defined/i,
    /sessionStorage is not defined/i,
    /self is not defined/i,
    /HTMLElement is not defined/i,
    /customElements is not defined/i,
    /getComputedStyle is not defined/i,
    /requestAnimationFrame is not defined/i,
    /matchMedia is not defined/i,
    /ResizeObserver is not defined/i,
    /IntersectionObserver is not defined/i,
    /MutationObserver is not defined/i,
  ];

  return browserGlobalPatterns.some((pattern) => pattern.test(errorMessage));
}
