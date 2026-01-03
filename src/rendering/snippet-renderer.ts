/**
 * Snippet Renderer
 *
 * Renders MDX snippet files as isolated component previews.
 * Works exactly like regular page rendering through the module server.
 */

import { rendererLogger as logger } from "@veryfront/utils";
import type { RenderMetadata } from "@veryfront/types";
import type { VeryfrontConfig } from "../core/config/types.ts";
import { wrapInHTMLShell } from "../html/html-shell-generator.ts";
import { LRUCache } from "../core/utils/lru-wrapper.ts";
import { registerCache } from "../core/memory/index.ts";

// Cache limits to prevent unbounded memory growth
const SNIPPET_CACHE_MAX_ENTRIES = 500;
const SNIPPET_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

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
 * Get a snippet from cache by hash
 */
export function getCompiledSnippet(hash: string): string | undefined {
  return snippetCache.get(hash)?.code;
}

/**
 * Clear all cached snippets - used during cache invalidation
 */
export function clearSnippetCache(): void {
  snippetCache.clear();
}

/**
 * Generate a hash for snippet content
 */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
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
export async function renderSnippet(
  mdxContent: string,
  options: SnippetRenderOptions,
): Promise<SnippetRenderResult> {
  logger.info("[SnippetRenderer] Starting render", {
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

    logger.info("[SnippetRenderer] MDX compiled", {
      codeLength: bundle.compiledCode.length,
      hasFrontmatter: !!bundle.frontmatter,
    });

    // 2. Store RAW compiled code in cache - no import transformations
    // module-server.ts will apply transformToESM to handle imports properly
    // for both SSR (npm: specifiers) and browser (esm.sh URLs) contexts
    const hash = await hashContent(mdxContent + (options.projectSlug || ""));
    snippetCache.set(hash, {
      code: bundle.compiledCode,
      frontmatter: bundle.frontmatter || {},
    });

    logger.info("[SnippetRenderer] Snippet cached", {
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

    logger.info("[SnippetRenderer] Loading snippet module", {
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

    logger.info("[SnippetRenderer] SSR complete", {
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
