/**
 * Markdown Preview Handler
 *
 * Serves standalone markdown files (*.md) with GitHub-style preview rendering.
 * Only active in preview/local dev mode. Files in pages/ or app/ are excluded.
 *
 * @module server/handlers/preview/markdown-preview-handler
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { HTTP_OK } from "#veryfront/utils/constants/index.ts";
import { compileMarkdownRuntime } from "#veryfront/transforms/md/compiler/md-compiler.ts";
import { extract } from "#std/front-matter/yaml.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { tryNotFoundFallback } from "../request/ssr/not-found-fallback.ts";
import { generateStudioBridgeScript } from "#veryfront/studio/bridge-template.ts";

// Priority 900: between MEDIUM (600) and LOW/SSR (1000)
const PRIORITY_MARKDOWN_PREVIEW = 900 as HandlerPriority;

export class MarkdownPreviewHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "MarkdownPreviewHandler",
    priority: PRIORITY_MARKDOWN_PREVIEW,
    patterns: [{ pattern: /\.md$/, method: "GET" }],
    enabled: (ctx) => ctx.isLocalProject || ctx.requestContext?.mode === "preview",
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (!pathname.endsWith(".md")) {
      logger.debug("[MarkdownPreviewHandler] Skipping - no .md extension", { pathname });
      return this.continue();
    }

    if (pathname.includes("/pages/") || pathname.includes("/app/") || pathname.startsWith("/_")) {
      return this.continue();
    }

    const filePath = pathname.replace(/^\//, "");
    const fsAdapter = ctx.adapter.fs;

    logger.debug("[MarkdownPreviewHandler] Attempting to serve", {
      pathname,
      filePath,
      projectDir: ctx.projectDir,
      projectSlug: ctx.projectSlug,
    });

    const hasMultiProjectSupport = isExtendedFSAdapter(fsAdapter) && fsAdapter.isMultiProjectMode();

    if (ctx.projectSlug && hasMultiProjectSupport) {
      const effectiveToken = ctx.proxyToken || getEnv("VERYFRONT_API_TOKEN") || "";
      const branch = ctx.parsedDomain?.branch ?? null;

      return await fsAdapter.runWithContext(
        ctx.projectSlug,
        effectiveToken,
        () => this.renderMarkdown(req, ctx, filePath, url),
        ctx.projectId,
        {
          productionMode: false,
          branch,
          environmentName: ctx.environmentName,
        },
      );
    }

    if (isExtendedFSAdapter(fsAdapter) && fsAdapter.isContextualMode()) {
      try {
        if (ctx.proxyToken) fsAdapter.setRequestToken(ctx.proxyToken);
        fsAdapter.setRequestBranch(ctx.parsedDomain?.branch ?? null);
        fsAdapter.setProductionMode(false);
      } catch {
        // Some operations may not be supported
      }
    }

    return await this.renderMarkdown(req, ctx, filePath, url);
  }

  private async renderMarkdown(
    req: Request,
    ctx: HandlerContext,
    filePath: string,
    url: URL,
  ): Promise<HandlerResult> {
    try {
      const resolveFile = ctx.adapter.fs.resolveFile;
      const resolvedPath = resolveFile ? await resolveFile.call(ctx.adapter.fs, filePath) : null;

      if (resolveFile) {
        logger.debug("[MarkdownPreviewHandler] resolveFile result", { filePath, resolvedPath });
      }

      let content: string;
      try {
        content = await ctx.adapter.fs.readFile(resolvedPath ?? filePath);
      } catch {
        logger.debug("[MarkdownPreviewHandler] File not found", { filePath, resolvedPath });

        const builder = this.createResponseBuilder(ctx);
        const notFoundResponse = await tryNotFoundFallback(req, filePath, ctx, builder);
        if (notFoundResponse) return this.respond(notFoundResponse);

        return this.continue();
      }

      let frontmatter: Record<string, unknown> = {};
      let body = content;

      try {
        const extracted = extract(content);
        frontmatter = extracted.attrs as Record<string, unknown>;
        body = extracted.body;
      } catch {
        // No frontmatter or malformed YAML
      }

      if (frontmatter.prose === false) {
        logger.debug("[MarkdownPreviewHandler] Skipping - prose: false", { filePath });
        return this.continue();
      }

      const bundle = await compileMarkdownRuntime(
        "development",
        ctx.projectDir,
        body,
        frontmatter,
        filePath,
        "server",
      );

      const colorModeParam = url.searchParams.get("color_mode")?.toLowerCase();
      const clientHint = req.headers
        .get("Sec-CH-Prefers-Color-Scheme")
        ?.replace(/"/g, "")
        .trim()
        .toLowerCase();

      let theme: "light" | "dark" | null = null;
      if (colorModeParam === "light" || colorModeParam === "dark") {
        theme = colorModeParam;
      } else if (clientHint === "light" || clientHint === "dark") {
        theme = clientHint;
      }

      const title = (frontmatter.title as string) || filePath;
      const description = (frontmatter.description as string) || "";

      const studioEmbed = url.searchParams.get("studio_embed") === "true";
      const studioScript = studioEmbed
        ? `<script>${
          generateStudioBridgeScript({
            projectId: ctx.projectSlug || ctx.projectId || "markdown-preview",
            pageId: filePath,
            pagePath: filePath,
          })
        }</script>`
        : "";

      const themeAttrs = theme ? ` data-theme="${theme}" style="color-scheme: ${theme};"` : "";
      const html = `<!DOCTYPE html>
<html lang="en"${themeAttrs}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${description ? `<meta name="description" content="${description}">` : ""}
  <title>${title}</title>

  <!-- GitHub Markdown Preview Styles -->
  <link rel="stylesheet" href="https://cdn.veryfront.com/styles/github-markdown.min.css">
  <link rel="stylesheet" href="https://cdn.veryfront.com/styles/github-syntax-highlighting.min.css">
  <link rel="stylesheet" href="https://cdn.veryfront.com/styles/mermaid.min.css">
</head>
<body>
  <article class="markdown-body" id="markdown-body">
    ${bundle.rawHtml || ""}
  </article>

  ${studioScript}

  <script type="module">
    import mermaid from 'https://esm.sh/mermaid@11';

    function getMermaidTheme() {
      return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';
    }

    async function initMermaid() {
      mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });
      // Convert code.language-mermaid blocks to mermaid-compatible format
      // Store original source in data attribute for theme changes
      const elements = [];
      document.querySelectorAll('code.language-mermaid').forEach((code) => {
        const pre = code.parentElement;
        if (pre?.tagName === 'PRE') {
          const div = document.createElement('pre');
          div.className = 'mermaid';
          div.dataset.source = code.textContent;
          div.textContent = code.textContent;
          div.style.visibility = 'hidden';
          pre.replaceWith(div);
          elements.push(div);
        }
      });
      await mermaid.run();
      elements.forEach((el) => el.style.visibility = '');
    }

    async function rerenderMermaid() {
      mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme() });
      // Hide, restore source, re-render, then show
      const elements = document.querySelectorAll('.mermaid');
      elements.forEach((el) => {
        if (el.dataset.source) {
          el.style.visibility = 'hidden';
          el.innerHTML = '';
          el.textContent = el.dataset.source;
          el.removeAttribute('data-processed');
        }
      });
      await mermaid.run();
      elements.forEach((el) => el.style.visibility = '');
    }

    // Initial render
    initMermaid();

    // Re-render mermaid when color mode changes (via Studio bridge)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-theme') {
          rerenderMermaid();
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  </script>

  <!-- Preview HMR -->
  <script src="/_veryfront/preview-hmr.js"></script>
</body>
</html>`;

      const responseBuilder = this.createResponseBuilder(ctx)
        .withCache("no-cache")
        .withContentType("text/html; charset=utf-8", html, HTTP_OK);

      logger.debug("[MarkdownPreviewHandler] Serving markdown preview", {
        filePath,
        htmlLength: html.length,
      });

      return this.respond(responseBuilder);
    } catch (error) {
      logger.error("[MarkdownPreviewHandler] Error rendering markdown", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.continue();
    }
  }
}
