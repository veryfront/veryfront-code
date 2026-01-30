import * as dntShim from "../../_dnt.shims.js";
import { rendererLogger as logger } from "../utils/index.js";
import { wrapInHTMLShell } from "../html/html-shell-generator.js";
import { LRUCache } from "../utils/lru-wrapper.js";
import { registerCache } from "../utils/memory/index.js";
import { escapeHtml } from "../html/html-escape.js";
import { createCacheBackend, MemoryCacheBackend, } from "../cache/backend.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
const SNIPPET_CACHE_MAX_ENTRIES = 500;
const SNIPPET_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SNIPPET_DISTRIBUTED_CACHE_TTL_SECONDS = 600; // 10 minutes for distributed cache
const snippetCache = new LRUCache({
    maxEntries: SNIPPET_CACHE_MAX_ENTRIES,
    ttlMs: SNIPPET_CACHE_TTL_MS,
    cleanupIntervalMs: 60000,
});
registerCache("snippet-cache", () => ({
    name: "snippet-cache",
    entries: snippetCache.size,
    maxEntries: SNIPPET_CACHE_MAX_ENTRIES,
}));
let distributedSnippetCache = null;
let distributedCacheInitPromise = null;
function getDistributedSnippetCache() {
    if (distributedSnippetCache)
        return Promise.resolve(distributedSnippetCache);
    if (distributedCacheInitPromise)
        return distributedCacheInitPromise;
    distributedCacheInitPromise = createCacheBackend({ keyPrefix: "snippet" })
        .then((backend) => {
        distributedSnippetCache = backend;
        logger.debug("[SnippetRenderer] Distributed cache initialized", {
            type: backend.type,
        });
        return backend;
    })
        .catch((error) => {
        logger.warn("[SnippetRenderer] Failed to initialize distributed cache, using memory", { error });
        distributedSnippetCache = new MemoryCacheBackend(SNIPPET_CACHE_MAX_ENTRIES);
        return distributedSnippetCache;
    });
    return distributedCacheInitPromise;
}
export function getCompiledSnippet(hash) {
    return snippetCache.get(hash)?.code;
}
export async function getCompiledSnippetAsync(hash) {
    const local = snippetCache.get(hash);
    if (local)
        return local.code;
    try {
        const cache = await getDistributedSnippetCache();
        const cached = await cache.get(hash);
        if (!cached)
            return undefined;
        const entry = JSON.parse(cached);
        snippetCache.set(hash, entry);
        logger.debug("[SnippetRenderer] Snippet cache hit from distributed cache", {
            hash,
        });
        return entry.code;
    }
    catch (error) {
        logger.debug("[SnippetRenderer] Failed to read from distributed cache", {
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
export function clearSnippetCache() {
    const entriesCleared = snippetCache.size;
    snippetCache.clear();
    logger.debug("[SnippetRenderer] ✓ Global snippet cache cleared", { entriesCleared });
}
export function clearSnippetCacheForProject(projectSlug) {
    const entriesCleared = snippetCache.size;
    // TODO(#127): Implement per-project snippet clearing once cache entries store projectSlug
    snippetCache.clear();
    logger.debug("[SnippetRenderer] ✓ Snippet cache cleared for project", {
        projectSlug,
        entriesCleared,
    });
}
const HEX_CHARS = "0123456789abcdef";
async function hashContent(content) {
    const data = new TextEncoder().encode(content);
    const hashBuffer = await dntShim.crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(hashBuffer);
    let hex = "";
    for (let i = 0; i < 8; i++) {
        const byte = bytes[i];
        hex += HEX_CHARS.charAt(byte >> 4) + HEX_CHARS.charAt(byte & 0xf);
    }
    return hex;
}
function getModuleServerBase(moduleServerUrl) {
    if (moduleServerUrl &&
        (moduleServerUrl.startsWith("http://") || moduleServerUrl.startsWith("https://"))) {
        // Deno's dynamic import() only supports file:// and http:// schemes.
        // In production, the module server is always local (same pod), so
        // downgrade https:// to http:// to avoid "Received protocol 'https:'" errors.
        return moduleServerUrl.replace(/^https:\/\//, "http://");
    }
    return "http://localhost:3002";
}
function getServerPort(moduleServerUrl) {
    if (!moduleServerUrl)
        return undefined;
    try {
        const url = new URL(moduleServerUrl);
        return url.port ? parseInt(url.port, 10) : undefined;
    }
    catch {
        return undefined;
    }
}
export function renderSnippet(mdxContent, options) {
    return withSpan("rendering.renderSnippet", async () => {
        logger.debug("[SnippetRenderer] Starting render", {
            contentLength: mdxContent.length,
            filePath: options.filePath,
        });
        try {
            const { compileContent } = await import("../transforms/mdx/compiler/index.js");
            const bundle = await compileContent(options.mode, options.projectDir, mdxContent, undefined, options.filePath);
            logger.debug("[SnippetRenderer] MDX compiled", {
                codeLength: bundle.compiledCode.length,
                hasFrontmatter: !!bundle.frontmatter,
            });
            const hash = await hashContent(mdxContent + (options.projectSlug ?? ""));
            const cacheEntry = {
                code: bundle.compiledCode,
                frontmatter: bundle.frontmatter ?? {},
            };
            snippetCache.set(hash, cacheEntry);
            getDistributedSnippetCache()
                .then((cache) => cache
                .set(hash, JSON.stringify(cacheEntry), SNIPPET_DISTRIBUTED_CACHE_TTL_SECONDS)
                .catch((error) => {
                logger.debug("[SnippetRenderer] Failed to store in distributed cache", { hash, error });
            }))
                .catch(() => {
                // Ignore - local cache is sufficient
            });
            logger.debug("[SnippetRenderer] Snippet cached", {
                hash,
                projectSlug: options.projectSlug,
                codePreview: bundle.compiledCode.substring(0, 300),
            });
            const moduleServerBase = getModuleServerBase(options.moduleServerUrl);
            const cacheBuster = Date.now();
            const snippetUrl = `${moduleServerBase}/_vf_modules/_snippets/${hash}.js?ssr=true&v=${cacheBuster}`;
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
            const [{ renderToString }, React] = await Promise.all([
                import("react-dom/server"),
                import("react"),
            ]);
            const element = React.createElement(MDXContent, {
                frontmatter: bundle.frontmatter ?? {},
            });
            const bodyHtml = renderToString(element);
            logger.debug("[SnippetRenderer] SSR complete", {
                bodyHtmlLength: bodyHtml.length,
            });
            const meta = {
                title: bundle.frontmatter?.name || "Component Preview",
                slug: options.filePath || "snippet",
                frontmatter: bundle.frontmatter,
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
            return { html, frontmatter: bundle.frontmatter ?? {} };
        }
        catch (error) {
            logger.error("[SnippetRenderer] Render failed", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            return {
                html: generateErrorHTML(error, options),
                frontmatter: {},
            };
        }
    }, {
        "snippet.contentLength": mdxContent.length,
        "snippet.filePath": options.filePath || "inline",
    });
}
function generateErrorHTML(error, options) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const nonce = options.nonce ? ` nonce="${options.nonce}"` : "";
    let stackHtml = "";
    if (options.mode === "development" && stack) {
        stackHtml = `<div class="error-stack">${escapeHtml(stack)}</div>`;
    }
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
