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
}

export interface SnippetRenderResult {
  html: string;
  frontmatter: Record<string, unknown>;
}

/**
 * Cache for compiled snippets
 * Key: content hash, Value: compiled JavaScript code
 */
const snippetCache = new Map<string, { code: string; frontmatter: Record<string, unknown> }>();

/**
 * Get a snippet from cache by hash
 */
export function getCompiledSnippet(hash: string): string | undefined {
  return snippetCache.get(hash)?.code;
}

/**
 * Generate a hash for snippet content
 */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
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

    // 2. Rewrite @/ imports to /_vf_modules/ URLs
    // Include project slug as query param for proxy mode
    let browserCode = bundle.compiledCode;
    const projectQueryParam = options.projectSlug ? `&project=${options.projectSlug}` : "";

    // Rewrite @/ imports to module server URLs with project context
    browserCode = browserCode.replace(
      /from\s+["']@\/([^"']+)["']/g,
      (_match, path) => {
        const jsPath = path.endsWith(".js") ? path : `${path}.js`;
        return `from "/_vf_modules/${jsPath}?ssr=true${projectQueryParam}"`;
      },
    );

    // Also handle dynamic imports
    browserCode = browserCode.replace(
      /import\(\s*["']@\/([^"']+)["']\s*\)/g,
      (_match, path) => {
        const jsPath = path.endsWith(".js") ? path : `${path}.js`;
        return `import("/_vf_modules/${jsPath}?ssr=true${projectQueryParam}")`;
      },
    );

    // 3. Store in cache with content hash (include projectSlug for uniqueness)
    const hash = await hashContent(mdxContent + (options.projectSlug || ""));
    snippetCache.set(hash, {
      code: browserCode,
      frontmatter: bundle.frontmatter || {},
    });

    logger.info("[SnippetRenderer] Snippet cached", {
      hash,
      projectSlug: options.projectSlug,
      codePreview: browserCode.substring(0, 300),
    });

    // 4. Import the snippet module via HTTP for SSR
    // Ensure moduleServerBase is a full HTTP URL (not relative path)
    let moduleServerBase = options.moduleServerUrl || "http://localhost:3002";
    if (!moduleServerBase.startsWith("http://") && !moduleServerBase.startsWith("https://")) {
      moduleServerBase = "http://localhost:3002";
    }
    const snippetUrl = `${moduleServerBase}/_vf_modules/_snippets/${hash}.js?ssr=true`;

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
      frontmatter: bundle.frontmatter || {},
    };

    const html = await wrapInHTMLShell(bodyHtml, meta, {
      mode: options.mode,
      config: options.config || {},
      projectDir: options.projectDir,
      nonce: options.nonce,
      studioEmbed: true, // Enable studio bridge for preview panel
      skipClientHydration: true, // SSR output is sufficient for snippet preview
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
