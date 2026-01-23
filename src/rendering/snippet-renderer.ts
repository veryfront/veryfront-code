/**
 * Snippet Renderer
 *
 * Renders MDX snippet files as isolated component previews.
 * Works exactly like regular page rendering through the module server.
 */

import { rendererLogger as logger } from "#veryfront/utils";
import type { RenderMetadata } from "#veryfront/types";
import type { VeryfrontConfig } from "../config/types.ts";
import { wrapInHTMLShell } from "../html/html-shell-generator.ts";
import { LRUCache } from "../utils/lru-wrapper.ts";
import { registerCache } from "../utils/memory/index.ts";
import { escapeHtml } from "../html/html-escape.ts";
import {
  type CacheBackend,
  createCacheBackend,
  MemoryCacheBackend,
} from "#veryfront/cache/backend.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

// Cache limits to prevent unbounded memory growth
const SNIPPET_CACHE_MAX_ENTRIES = 500;
const SNIPPET_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SNIPPET_DISTRIBUTED_CACHE_TTL_SECONDS = 600; // 10 minutes for distributed cache

export interface SnippetRenderOptions {
  mode: "development" | "production";
  projectDir: string;
  filePath?: string;
  nonce?: string;
  /** Base URL for module server (e.g., http://localhost:3002) */
  moduleServerUrl?: string;
  /** Project slug for proxy mode (needed to resolve @/ imports) */
  projectSlug?: string;
  /** Project config for styling, theme, and HMR settings */
  config?: VeryfrontConfig;
  /** Entity UUID from Studio to use for page_id (for postMessage communication) */
  pageId?: string;
}

export interface SnippetRenderResult {
  html: string;
  frontmatter: Record<string, unknown>;
}

interface SnippetCacheEntry {
  code: string;
  frontmatter: Record<string, unknown>;
}

/**
 * Cache for compiled snippets
 * Key: content hash, Value: compiled JavaScript code
 * Using LRU cache with limits to prevent unbounded memory growth
 */
const snippetCache = new LRUCache<string, SnippetCacheEntry>({
  maxEntries: SNIPPET_CACHE_MAX_ENTRIES,
  ttlMs: SNIPPET_CACHE_TTL_MS,
  cleanupIntervalMs: 60000,
});

// Register with memory profiler
registerCache("snippet-cache", () => ({
  name: "snippet-cache",
  entries: snippetCache.size,
  maxEntries: SNIPPET_CACHE_MAX_ENTRIES,
}));

/**
 * Distributed cache for cross-pod snippet sharing.
 * Uses API/Redis in production, memory fallback in development.
 */
let distributedSnippetCache: CacheBackend | null = null;
let distributedCacheInitPromise: Promise<CacheBackend> | null = null;

/**
 * Get or initialize the distributed snippet cache backend.
 */
function getDistributedSnippetCache(): Promise<CacheBackend> {
  if (distributedSnippetCache) return Promise.resolve(distributedSnippetCache);
  if (distributedCacheInitPromise) return distributedCacheInitPromise;

  distributedCacheInitPromise = createCacheBackend({ keyPrefix: "snippet" })
    .then((backend) => {
      distributedSnippetCache = backend;
      logger.debug("[SnippetRenderer] Distributed cache initialized", {
        type: backend.type,
      });
      return backend;
    })
    .catch((error) => {
      logger.warn(
        "[SnippetRenderer] Failed to initialize distributed cache, using memory",
        { error },
      );
      distributedSnippetCache = new MemoryCacheBackend(SNIPPET_CACHE_MAX_ENTRIES);
      return distributedSnippetCache;
    });

  return distributedCacheInitPromise;
}

/**
 * Get a snippet from cache by hash (sync version for backwards compatibility).
 * Checks local memory cache only.
 */
export function getCompiledSnippet(hash: string): string | undefined {
  return snippetCache.get(hash)?.code;
}

/**
 * Get a snippet from cache by hash (async version).
 * Checks local memory first, then falls back to distributed cache.
 */
export async function getCompiledSnippetAsync(
  hash: string,
): Promise<string | undefined> {
  // Check local cache first (fast path)
  const local = snippetCache.get(hash);
  if (local) {
    return local.code;
  }

  // Check distributed cache
  try {
    const cache = await getDistributedSnippetCache();
    const cached = await cache.get(hash);
    if (cached) {
      // Parse the cached JSON and populate local cache
      const entry = JSON.parse(cached) as SnippetCacheEntry;
      snippetCache.set(hash, entry);
      logger.debug("[SnippetRenderer] Snippet cache hit from distributed cache", {
        hash,
      });
      return entry.code;
    }
  } catch (error) {
    logger.debug("[SnippetRenderer] Failed to read from distributed cache", {
      hash,
      error,
    });
  }

  return undefined;
}

/**
 * Clear all cached snippets - used during cache invalidation
 * @deprecated Use clearSnippetCacheForProject for multi-tenant deployments
 */
export function clearSnippetCache(): void {
  const startTime = Date.now();
  const entriesCleared = snippetCache.size;
  snippetCache.clear();
  logger.info("[SnippetRenderer] ✓ Global snippet cache cleared", {
    entriesCleared,
    durationMs: Date.now() - startTime,
  });
}

/**
 * Clear cached snippets for a specific project.
 * Snippets are keyed by content hash + projectSlug, so we clear entries
 * where the key was generated with the given project slug.
 *
 * Note: Since we hash content + projectSlug together, we can't directly identify
 * which entries belong to which project. For now, this clears all snippets.
 * A future optimization could store projectSlug separately in the cache entry.
 */
export function clearSnippetCacheForProject(projectSlug: string): void {
  const startTime = Date.now();
  const entriesCleared = snippetCache.size;
  // TODO(#127): Implement per-project snippet clearing once cache entries store projectSlug
  // For now, clear all to ensure correctness over efficiency
  snippetCache.clear();
  logger.info("[SnippetRenderer] ✓ Snippet cache cleared for project", {
    projectSlug,
    entriesCleared,
    note: "Currently clears all entries - per-project clearing not yet implemented",
    durationMs: Date.now() - startTime,
  });
}

// Hex lookup table for efficient byte-to-hex conversion
const HEX_CHARS = "0123456789abcdef";

/**
 * Generate a hash for snippet content - optimized single-pass hex encoding
 */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);
  // Single-pass hex encoding without intermediate array allocations
  let hex = "";
  for (let i = 0; i < 8; i++) {
    const byte = bytes[i]!;
    hex += HEX_CHARS.charAt(byte >> 4) + HEX_CHARS.charAt(byte & 0xf);
  }
  return hex;
}

/**
 * Render an MDX snippet to HTML using SSR
 *
 * Works like any other page rendering:
 * 1. Compile MDX to JavaScript
 * 2. Store compiled code in snippet cache
 * 3. Import via module server URL (handles @/ resolution)
 * 4. Render to HTML with React SSR
 */
export function renderSnippet(
  mdxContent: string,
  options: SnippetRenderOptions,
): Promise<SnippetRenderResult> {
  return withSpan("rendering.renderSnippet", async () => {
    logger.debug("[SnippetRenderer] Starting render", {
      contentLength: mdxContent.length,
      filePath: options.filePath,
    });

    try {
      // 1. Compile MDX to JavaScript
      const { compileMDXRuntime } = await import(
        "@veryfront/transforms/mdx/compiler/index.ts"
      );

      const bundle = await compileMDXRuntime(
        options.mode,
        options.projectDir,
        mdxContent,
        undefined,
        options.filePath,
      );

      logger.debug("[SnippetRenderer] MDX compiled", {
        codeLength: bundle.compiledCode.length,
        hasFrontmatter: !!bundle.frontmatter,
      });

      // 2. Store RAW compiled code in cache - no import transformations
      // module-server.ts will apply transformToESM to handle imports properly
      // for both SSR (cached file://) and browser (esm.sh URLs) contexts
      const hash = await hashContent(mdxContent + (options.projectSlug || ""));
      const cacheEntry: SnippetCacheEntry = {
        code: bundle.compiledCode,
        frontmatter: bundle.frontmatter || {},
      };

      // Store in local cache (fast reads)
      snippetCache.set(hash, cacheEntry);

      // Store in distributed cache asynchronously (cross-pod sharing)
      getDistributedSnippetCache()
        .then((cache) => {
          cache
            .set(hash, JSON.stringify(cacheEntry), SNIPPET_DISTRIBUTED_CACHE_TTL_SECONDS)
            .catch((error) => {
              logger.debug(
                "[SnippetRenderer] Failed to store in distributed cache",
                { hash, error },
              );
            });
        })
        .catch(() => {
          // Ignore - local cache is sufficient
        });

      logger.debug("[SnippetRenderer] Snippet cached", {
        hash,
        projectSlug: options.projectSlug,
        codePreview: bundle.compiledCode.substring(0, 300),
      });

      // 4. Import the snippet module via HTTP for SSR
      // Ensure moduleServerBase is a full HTTP URL (not relative path)
      let moduleServerBase = options.moduleServerUrl || "http://localhost:3002";
      if (!moduleServerBase.startsWith("http://") && !moduleServerBase.startsWith("https://")) {
        moduleServerBase = "http://localhost:3002";
      }
      // Add cache buster to ensure Deno fetches fresh module each time
      const cacheBuster = Date.now();
      const snippetUrl =
        `${moduleServerBase}/_vf_modules/_snippets/${hash}.js?ssr=true&v=${cacheBuster}`;

      logger.debug("[SnippetRenderer] Loading snippet module", {
        snippetUrl,
        moduleServerBase,
        providedUrl: options.moduleServerUrl,
      });

      const module = await import(snippetUrl);

      const MDXContent = module.default || module.MDXContent;
      if (!MDXContent) {
        throw new Error("No MDXContent export found in compiled snippet");
      }

      // 5. Render to HTML string with React SSR
      const { renderToString } = await import("react-dom/server");
      const React = await import("react");

      const element = React.createElement(MDXContent, {
        frontmatter: bundle.frontmatter || {},
      });
      const bodyHtml = renderToString(element);

      logger.debug("[SnippetRenderer] SSR complete", {
        bodyHtmlLength: bodyHtml.length,
      });

      // 6. Wrap in HTML shell (same as regular pages)
      const meta: RenderMetadata = {
        title: (bundle.frontmatter?.name as string) || "Component Preview",
        slug: options.filePath || "snippet",
        frontmatter: bundle.frontmatter as RenderMetadata["frontmatter"],
      };

      // Merge config with HMR enabled for live reload
      // Extract port from moduleServerUrl for HMR WebSocket connection
      let serverPort: number | undefined;
      if (options.moduleServerUrl) {
        try {
          const url = new URL(options.moduleServerUrl);
          serverPort = url.port ? parseInt(url.port, 10) : undefined;
        } catch {
          // Ignore invalid URL
        }
      }

      const snippetConfig = {
        ...options.config,
        dev: {
          ...options.config?.dev,
          hmr: true,
          port: serverPort ?? options.config?.dev?.port,
          // Don't set hmrPort explicitly - let dev-scripts.ts use the default port + 1 logic
        },
      };

      const html = await wrapInHTMLShell(bodyHtml, meta, {
        mode: options.mode,
        config: snippetConfig,
        projectDir: options.projectDir,
        nonce: options.nonce,
        studioEmbed: true, // Enable studio bridge for preview panel
        pagePath: `_snippets/${hash}`, // Point to cached snippet module for hydration
        pageId: options.pageId, // Pass entity UUID for Studio postMessage communication
      });

      return {
        html,
        frontmatter: bundle.frontmatter || {},
      };
    } catch (error) {
      logger.error("[SnippetRenderer] Render failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Return error HTML
      const errorHtml = generateErrorHTML(error, options);
      return {
        html: errorHtml,
        frontmatter: {},
      };
    }
  }, {
    "snippet.contentLength": mdxContent.length,
    "snippet.filePath": options.filePath || "inline",
  });
}

function generateErrorHTML(error: unknown, options: SnippetRenderOptions): string {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const nonce = options.nonce ? ` nonce="${options.nonce}"` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Snippet Error</title>
  <style${nonce}>
    body {
      margin: 0;
      padding: 1rem;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fef2f2;
    }
    .error-container {
      padding: 1rem;
      background: #ffffff;
      border: 1px solid #fecaca;
      border-radius: 0.5rem;
      color: #dc2626;
    }
    .error-title {
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .error-message {
      font-family: monospace;
      font-size: 0.875rem;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .error-stack {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid #fecaca;
      font-size: 0.75rem;
      color: #991b1b;
      white-space: pre-wrap;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-title">Snippet Render Error</div>
    <div class="error-message">${escapeHtml(message)}</div>
    ${
    options.mode === "development" && stack
      ? `<div class="error-stack">${escapeHtml(stack)}</div>`
      : ""
  }
  </div>
</body>
</html>`;
}
