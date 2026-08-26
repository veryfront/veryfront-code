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
import { serverLogger } from "#veryfront/utils";
import { HTTP_OK } from "#veryfront/utils/constants/index.ts";
import { compileMarkdownRuntime } from "#veryfront/transforms/md/compiler/md-compiler.ts";
import { extract } from "#std/front-matter/yaml.ts";
import { tryNotFoundFallback } from "../request/ssr/not-found-fallback.ts";
import { generateMarkdownHtml } from "./markdown-html-generator.ts";
import { validateLexicalPath, validatePath, ValidationPresets } from "#veryfront/security";
import { requiresIsolatedProjectRuntime } from "#veryfront/security/project-locality.ts";
import {
  createErrorResponseFromDefinition,
  PROJECT_EXECUTION_UNAVAILABLE,
  SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE,
} from "#veryfront/errors";
import { markdownPreviewOwnsDocumentPathname } from "../request/ssr/document-ownership.ts";
import {
  ensurePreviewDocumentSourceSnapshot,
  finishPreviewDocumentSourceSnapshot,
} from "../request/source-snapshot-freshness.ts";

const logger = serverLogger.component("markdown-preview-handler");

// Priority 900: between MEDIUM (600) and LOW/SSR (1000)
const PRIORITY_MARKDOWN_PREVIEW = 900 as HandlerPriority;
const MAX_DOCUMENT_OWNERSHIP_RECLASSIFICATIONS = 3;

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

    if (!markdownPreviewOwnsDocumentPathname(pathname)) {
      logger.debug("Skipping - not a standalone Markdown document", { pathname });
      return this.continue();
    }

    if (requiresIsolatedProjectRuntime(ctx)) {
      const problem = createErrorResponseFromDefinition(
        PROJECT_EXECUTION_UNAVAILABLE,
        {
          detail:
            "Shared runtimes require a dedicated isolated project runtime for markdown rendering",
          instance: pathname,
        },
      );
      const response = this.createResponseBuilder(ctx)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-store")
        .withHeaders(problem.headers)
        .build(problem.body, problem.status);
      return Promise.resolve(this.respond(response));
    }

    const filePath = pathname.replace(/^\//, "");

    const pathResult = validateLexicalPath(filePath, {
      baseDir: ctx.projectDir,
    });

    if (!pathResult.valid) {
      logger.warn("Path traversal blocked in markdown preview", { pathname, filePath });
      return this.continue();
    }

    logger.debug("Attempting to serve", {
      pathname,
      filePath,
      projectDir: ctx.projectDir,
      projectSlug: ctx.projectSlug,
    });

    return await this.withProxyContext(
      ctx,
      () => this.renderCurrentMarkdown(req, ctx, filePath, url),
      { requireToken: true },
    );
  }

  private async renderCurrentMarkdown(
    req: Request,
    ctx: HandlerContext,
    filePath: string,
    url: URL,
  ): Promise<HandlerResult> {
    for (
      let attempts = 0;
      attempts <= MAX_DOCUMENT_OWNERSHIP_RECLASSIFICATIONS;
      attempts++
    ) {
      let reclassify = await ensurePreviewDocumentSourceSnapshot(ctx);
      if (reclassify === undefined) {
        const rendered = await this.renderMarkdown(req, ctx, filePath, url);
        // Rendering can cross an edit after the pre-render freshness check.
        // Validate the retained generation outside renderMarkdown's error-to-
        // continue catch so a mixed-generation document fails closed.
        reclassify = await finishPreviewDocumentSourceSnapshot(ctx);
        if (reclassify === undefined) return rendered;
      }
      if (attempts === MAX_DOCUMENT_OWNERSHIP_RECLASSIFICATIONS) {
        throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
          detail:
            `The source snapshot for "${ctx.projectSlug}" changed during Markdown document ownership classification or rendering ${MAX_DOCUMENT_OWNERSHIP_RECLASSIFICATIONS} times, so this request cannot safely render it.`,
        });
      }
      const reclassified = await reclassify();
      if (reclassified.response || !reclassified.continue) return reclassified;
    }

    throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
      detail: `The source snapshot for "${ctx.projectSlug}" could not be stabilized.`,
    });
  }

  private async renderMarkdown(
    req: Request,
    ctx: HandlerContext,
    filePath: string,
    url: URL,
  ): Promise<HandlerResult> {
    try {
      const fs = ctx.adapter.fs;
      const stableAdapter = { fs } as typeof ctx.adapter;
      const resolveFile = fs.resolveFile;
      const resolvedPath = resolveFile ? await resolveFile.call(fs, filePath) : null;

      if (resolveFile) {
        logger.debug("resolveFile result", { filePath, resolvedPath });
      }

      const admittedPath = resolvedPath ?? filePath;
      const pathResult = await validatePath(admittedPath, {
        ...ValidationPresets.internal(ctx.projectDir),
        adapter: stableAdapter,
      });
      if (!pathResult.valid || !pathResult.canonicalPath) {
        logger.warn("Physical path validation blocked markdown preview", {
          filePath,
          resolvedPath,
        });
        return this.continue();
      }

      let content: string;
      try {
        content = await fs.readFile(pathResult.canonicalPath);
      } catch (_) {
        /* expected: markdown file may not exist */
        logger.debug("File not found", { filePath, resolvedPath });

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
      } catch (_) {
        /* expected: no frontmatter or malformed YAML */
      }

      if (frontmatter.prose === false) {
        logger.debug("Skipping - prose: false", { filePath });
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

      const responseBuilder = this.createResponseBuilder(ctx);
      const html = generateMarkdownHtml({
        rawHtml: bundle.rawHtml || "",
        title: frontmatter.title != null ? String(frontmatter.title) : filePath,
        description: frontmatter.description != null ? String(frontmatter.description) : "",
        request: req,
        url,
        projectId: ctx.projectSlug || ctx.projectId || "markdown-preview",
        filePath,
        nonce: responseBuilder.nonce,
      });

      responseBuilder
        .withCache("no-cache")
        .withSecurity(ctx.securityConfig ?? undefined, req);
      const response = responseBuilder.withContentType("text/html; charset=utf-8", html, HTTP_OK);

      logger.debug("Serving markdown preview", {
        filePath,
        htmlLength: html.length,
      });

      return this.respond(response);
    } catch (error) {
      logger.error("Error rendering markdown", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.continue();
    }
  }
}
