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
import { generateHTMLShellParts } from "#veryfront/html";
import type { MDXFrontmatter } from "#veryfront/types";
import { extract } from "#std/front-matter/yaml.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { tryNotFoundFallback } from "../request/ssr/not-found-fallback.ts";

// Priority 900: between MEDIUM (600) and LOW/SSR (1000)
const PRIORITY_MARKDOWN_PREVIEW = 900 as HandlerPriority;

export class MarkdownPreviewHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "MarkdownPreviewHandler",
    priority: PRIORITY_MARKDOWN_PREVIEW,
    patterns: [{ pattern: /\.md$/, method: "GET" }],
    enabled: (ctx) => {
      return ctx.requestContext?.isLocalDev === true || ctx.requestContext?.mode === "preview";
    },
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Only handle .md files (not .mdx which are page components)
    if (!pathname.endsWith(".md")) {
      logger.debug("[MarkdownPreviewHandler] Skipping - no .md extension", { pathname });
      return this.continue();
    }

    // Skip files in pages/ or app/ directories - those are routed normally
    if (pathname.includes("/pages/") || pathname.includes("/app/")) {
      return this.continue();
    }

    // Skip internal paths
    if (pathname.startsWith("/_")) {
      return this.continue();
    }

    const filePath = pathname.replace(/^\//, ""); // Remove leading slash
    const fsAdapter = ctx.adapter.fs;

    logger.debug("[MarkdownPreviewHandler] Attempting to serve", {
      pathname,
      filePath,
      projectDir: ctx.projectDir,
      projectSlug: ctx.projectSlug,
    });

    // Handle multi-project mode (preview)
    const hasMultiProjectSupport = isExtendedFSAdapter(fsAdapter) &&
      fsAdapter.isMultiProjectMode();

    if (ctx.projectSlug && hasMultiProjectSupport) {
      const effectiveToken = ctx.proxyToken || getEnv("VERYFRONT_API_TOKEN") || "";
      const branch = ctx.parsedDomain?.branch ?? null;

      return await fsAdapter.runWithContext(
        ctx.projectSlug,
        effectiveToken,
        () => this.renderMarkdown(req, ctx, filePath, url),
        ctx.projectId,
        {
          productionMode: false, // Preview mode
          branch,
          environmentName: ctx.environmentName,
        },
      );
    }

    // Handle contextual mode (single project)
    if (isExtendedFSAdapter(fsAdapter) && fsAdapter.isContextualMode()) {
      try {
        if (ctx.proxyToken) {
          fsAdapter.setRequestToken(ctx.proxyToken);
        }
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
      // Try to resolve the file path (handles extension lookup)
      const resolveFile = ctx.adapter.fs.resolveFile;
      let resolvedPath: string | null = null;

      if (resolveFile) {
        // Try the exact path first
        resolvedPath = await resolveFile.call(ctx.adapter.fs, filePath);
        logger.debug("[MarkdownPreviewHandler] resolveFile result", { filePath, resolvedPath });
      }

      // Read file content
      let content: string;
      try {
        const pathToRead = resolvedPath || filePath;
        content = await ctx.adapter.fs.readFile(pathToRead);
      } catch {
        logger.debug("[MarkdownPreviewHandler] File not found", { filePath, resolvedPath });
        // Return project's styled 404 page
        const builder = this.createResponseBuilder(ctx);
        const notFoundResponse = await tryNotFoundFallback(req, filePath, ctx, builder);
        if (notFoundResponse) {
          return this.respond(notFoundResponse);
        }
        return this.continue();
      }

      // Extract frontmatter
      let frontmatter: Record<string, unknown> = {};
      let body = content;
      try {
        const extracted = extract(content);
        frontmatter = extracted.attrs as Record<string, unknown>;
        body = extracted.body;
      } catch {
        // No frontmatter or malformed YAML
      }

      // Check for prose: false opt-out
      if (frontmatter.prose === false) {
        logger.debug("[MarkdownPreviewHandler] Skipping - prose: false", { filePath });
        return this.continue();
      }

      // Compile markdown
      const bundle = await compileMarkdownRuntime(
        "development",
        ctx.projectDir,
        body,
        frontmatter,
        filePath,
        "server",
      );

      // Wrap in div to match client-side MDContent (class added by MDContent)
      const bodyContent = `<div class="markdown-body">${bundle.rawHtml || ""}</div>`;

      // Get color scheme
      const colorScheme = url.searchParams.get("color_mode") as "light" | "dark" | null;

      // Generate HTML shell
      const { start, end } = await generateHTMLShellParts(
        {
          title: frontmatter.title as string || filePath,
          description: frontmatter.description as string || "",
          slug: filePath,
          frontmatter: bundle.frontmatter as MDXFrontmatter,
          ssrHash: "",
        },
        {
          mode: "development",
          config: ctx.config ?? {},
          projectDir: ctx.projectDir,
          pagePath: filePath,
          pageType: "md",
          frontmatter: bundle.frontmatter as MDXFrontmatter,
          environment: ctx.requestContext?.mode === "preview" ? "preview" : undefined,
          isLocalDev: ctx.requestContext?.isLocalDev ?? false,
          colorScheme: colorScheme || "light",
          colorSchemeFromParam: !!colorScheme,
        },
        {},
        {},
        bodyContent,
      );

      const html = `${start}${bodyContent}${end}`;

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
