import { computeHash, rendererLogger } from "#veryfront/utils";
import { RENDER_ERROR } from "#veryfront/errors/error-registry.ts";
import type { RenderMetadata } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { wrapInHTMLShell } from "#veryfront/html/html-shell-generator.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import {
  type CacheBackend,
  createCacheBackend,
  MemoryCacheBackend,
} from "#veryfront/cache/backend.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = rendererLogger.component("snippet-renderer");

const SNIPPET_CACHE_MAX_ENTRIES = 500;
const SNIPPET_CACHE_TTL_MS = 10 * 60 * 1_000; // 10 minutes
const SNIPPET_DISTRIBUTED_CACHE_TTL_SECONDS = 600; // 10 minutes for distributed cache
const SNIPPET_CACHE_CLEANUP_INTERVAL_MS = 60_000;

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
  projectSlug?: string;
}

const snippetCache = new LRUCache<string, SnippetCacheEntry>({
  maxEntries: SNIPPET_CACHE_MAX_ENTRIES,
  ttlMs: SNIPPET_CACHE_TTL_MS,
  cleanupIntervalMs: SNIPPET_CACHE_CLEANUP_INTERVAL_MS,
});

registerCache("snippet-cache", () => ({
  name: "snippet-cache",
  entries: snippetCache.size,
  maxEntries: SNIPPET_CACHE_MAX_ENTRIES,
}));

let distributedSnippetCache: CacheBackend | null = null;
let distributedCacheInitPromise: Promise<CacheBackend> | null = null;

async function getDistributedSnippetCache(): Promise<CacheBackend> {
  if (distributedSnippetCache) return distributedSnippetCache;
  if (distributedCacheInitPromise) return distributedCacheInitPromise;

  distributedCacheInitPromise = (async () => {
    try {
      const backend = await createCacheBackend({ keyPrefix: "snippet" });
      distributedSnippetCache = backend;
      logger.debug("Distributed cache initialized", {
        type: backend.type,
      });
      return backend;
    } catch (error) {
      logger.warn(
        "[SnippetRenderer] Failed to initialize distributed cache, using memory",
        { error },
      );
      distributedSnippetCache = new MemoryCacheBackend(SNIPPET_CACHE_MAX_ENTRIES);
      return distributedSnippetCache;
    }
  })();

  return distributedCacheInitPromise;
}

export function getCompiledSnippet(hash: string): string | undefined {
  return snippetCache.get(hash)?.code;
}

export async function getCompiledSnippetAsync(
  hash: string,
): Promise<string | undefined> {
  const local = snippetCache.get(hash);
  if (local) return local.code;

  try {
    const cache = await getDistributedSnippetCache();
    const cached = await cache.get(hash);
    if (!cached) return undefined;

    const entry = JSON.parse(cached) as SnippetCacheEntry;
    snippetCache.set(hash, entry);
    logger.debug("Snippet cache hit from distributed cache", {
      hash,
    });
    return entry.code;
  } catch (error) {
    logger.debug("Failed to read from distributed cache", {
      hash,
      error,
    });
    return undefined;
  }
}

/**
 * Clear all cached snippets - used during cache invalidation
 * @deprecated Use clearSnippetCacheForProject for multi-tenant deployments
 */
export function clearSnippetCache(): void {
  const keysToDelete = [...snippetCache.keys()];
  const entriesCleared = keysToDelete.length;
  snippetCache.clear();
  logger.debug("✓ Global snippet cache cleared", { entriesCleared });

  if (keysToDelete.length === 0) return;

  void (async () => {
    try {
      const cache = await getDistributedSnippetCache();
      await Promise.allSettled(keysToDelete.map((key) => cache.del(key)));
    } catch {
      // Ignore distributed cache clear failures
    }
  })();
}

export function clearSnippetCacheForProject(projectSlug: string): void {
  const keysToDelete: string[] = [];

  for (const [key, entry] of snippetCache.entries()) {
    if (entry?.projectSlug === projectSlug) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    snippetCache.delete(key);
  }

  logger.debug("✓ Snippet cache cleared for project", {
    projectSlug,
    entriesCleared: keysToDelete.length,
  });

  if (keysToDelete.length === 0) return;

  void (async () => {
    try {
      const cache = await getDistributedSnippetCache();
      await Promise.allSettled(keysToDelete.map((key) => cache.del(key)));
    } catch {
      // Ignore distributed cache clear failures
    }
  })();
}

function getModuleServerBase(moduleServerUrl?: string): string {
  if (!moduleServerUrl) return "http://localhost:3002";

  if (moduleServerUrl.startsWith("http://")) return moduleServerUrl;
  if (moduleServerUrl.startsWith("https://")) return moduleServerUrl;

  return "http://localhost:3002";
}

function getServerPort(moduleServerUrl?: string): number | undefined {
  if (!moduleServerUrl) return undefined;

  try {
    const url = new URL(moduleServerUrl);
    return url.port ? parseInt(url.port, 10) : undefined;
  } catch (_) {
    /* expected: invalid URL string */
    return undefined;
  }
}

export function renderSnippet(
  mdxContent: string,
  options: SnippetRenderOptions,
): Promise<SnippetRenderResult> {
  return withSpan(
    "rendering.renderSnippet",
    async () => {
      logger.debug("Starting render", {
        contentLength: mdxContent.length,
        filePath: options.filePath,
      });

      try {
        const { compileContent } = await import(
          "#veryfront/transforms/mdx/compiler/index.ts"
        );

        const bundle = await compileContent(
          options.mode,
          options.projectDir,
          mdxContent,
          undefined,
          options.filePath,
        );

        logger.debug("MDX compiled", {
          codeLength: bundle.compiledCode.length,
          hasFrontmatter: !!bundle.frontmatter,
        });

        const hash = (await computeHash(mdxContent + (options.projectSlug ?? ""))).slice(0, 16);
        const frontmatter = bundle.frontmatter ?? {};
        const cacheEntry: SnippetCacheEntry = {
          code: bundle.compiledCode,
          frontmatter,
          projectSlug: options.projectSlug,
        };

        snippetCache.set(hash, cacheEntry);

        void (async () => {
          try {
            const cache = await getDistributedSnippetCache();
            await cache.set(
              hash,
              JSON.stringify(cacheEntry),
              SNIPPET_DISTRIBUTED_CACHE_TTL_SECONDS,
            );
          } catch (error) {
            logger.debug(
              "[SnippetRenderer] Failed to store in distributed cache",
              { hash, error },
            );
          }
        })();

        logger.debug("Snippet cached", {
          hash,
          projectSlug: options.projectSlug,
          codePreview: bundle.compiledCode.substring(0, 300),
        });

        const moduleServerBase = getModuleServerBase(options.moduleServerUrl);
        const cacheBuster = Date.now();
        const snippetUrl =
          `${moduleServerBase}/_vf_modules/_snippets/${hash}.js?ssr=true&v=${cacheBuster}`;

        logger.debug("Loading snippet module", {
          snippetUrl,
          moduleServerBase,
          providedUrl: options.moduleServerUrl,
        });

        const module = await import(snippetUrl);
        const MDXContent = module.default || module.MDXContent;
        if (!MDXContent) {
          throw RENDER_ERROR.create({ detail: "No MDXContent export found in compiled snippet" });
        }

        const [{ renderToString }, React] = await Promise.all([
          import("react-dom/server"),
          import("react"),
        ]);

        const element = React.createElement(MDXContent, { frontmatter });
        const bodyHtml = renderToString(element);

        logger.debug("SSR complete", {
          bodyHtmlLength: bodyHtml.length,
        });

        const meta: RenderMetadata = {
          title: (bundle.frontmatter?.name as string) || "Component Preview",
          slug: options.filePath || "snippet",
          frontmatter: bundle.frontmatter as RenderMetadata["frontmatter"],
        };

        const serverPort = getServerPort(options.moduleServerUrl);
        const snippetConfig = {
          ...options.config,
          dev: {
            ...options.config?.dev,
            hmr: true,
            port: serverPort ?? options.config?.dev?.port,
          },
        };

        const html = await wrapInHTMLShell(bodyHtml, meta, {
          mode: options.mode,
          config: snippetConfig,
          projectDir: options.projectDir,
          nonce: options.nonce,
          studioEmbed: true,
          pagePath: `_snippets/${hash}`,
          pageId: options.pageId,
        });

        return { html, frontmatter };
      } catch (error) {
        logger.error("Render failed", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });

        return {
          html: generateErrorHTML(error, options),
          frontmatter: {},
        };
      }
    },
    {
      "snippet.contentLength": mdxContent.length,
      "snippet.filePath": options.filePath || "inline",
    },
  );
}

function generateErrorHTML(error: unknown, options: SnippetRenderOptions): string {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const nonce = options.nonce ? ` nonce="${options.nonce}"` : "";
  const stackHtml = options.mode === "development" && stack
    ? `<div class="error-stack">${escapeHtml(stack)}</div>`
    : "";

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
    ${stackHtml}
  </div>
</body>
</html>`;
}
