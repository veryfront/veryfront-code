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
import { isExtendedFSAdapter, NotSupportedError } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
import { tryNotFoundFallback } from "../request/ssr/not-found-fallback.ts";
import { generateMarkdownHtml } from "./markdown-html-generator.ts";
import { validatePath } from "#veryfront/security";
import { getRequestTokenProvenance } from "../../context/request-context.ts";

const logger = serverLogger.component("markdown-preview-handler");

// Priority 900: between MEDIUM (600) and LOW/SSR (1000)
const PRIORITY_MARKDOWN_PREVIEW = 900 as HandlerPriority;

function isCanonicalNotSupportedError(error: unknown): boolean {
  try {
    return error instanceof NotSupportedError;
  } catch {
    return false;
  }
}

export class MarkdownPreviewHandler extends BaseHandler {
  constructor(
    private readonly compileMarkdown: typeof compileMarkdownRuntime = compileMarkdownRuntime,
    private readonly generateHtml: typeof generateMarkdownHtml = generateMarkdownHtml,
    private readonly notFoundFallback: typeof tryNotFoundFallback = tryNotFoundFallback,
  ) {
    super();
  }

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
      logger.debug("Skipping - no .md extension", { pathname });
      return this.continue();
    }

    if (pathname.includes("/pages/") || pathname.includes("/app/") || pathname.startsWith("/_")) {
      return this.continue();
    }

    const filePath = pathname.replace(/^\//, "");

    const pathResult = await validatePath(filePath, {
      baseDir: ctx.projectDir,
      adapter: ctx.adapter,
      level: "strict",
      allowAbsolute: false,
    });

    if (!pathResult.valid || !pathResult.canonicalPath) {
      logger.warn("Path traversal blocked in markdown preview", { pathname, filePath });
      return this.continue();
    }
    const admittedPath = pathResult.canonicalPath;

    const fsAdapter = ctx.adapter.fs;

    logger.debug("Attempting to serve", {
      pathname,
      filePath,
      projectDir: ctx.projectDir,
      projectSlug: ctx.projectSlug,
    });

    const hasMultiProjectSupport = isExtendedFSAdapter(fsAdapter) && fsAdapter.isMultiProjectMode();

    if (ctx.projectSlug && hasMultiProjectSupport) {
      // Framework-owned token: bypass project env overlay so proxy mode works
      // when a remote project overlay is active.
      const effectiveToken = ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN") || "";
      const branch = ctx.parsedDomain?.branch ?? null;

      return await fsAdapter.runWithContext(
        ctx.projectSlug,
        effectiveToken,
        () => this.renderMarkdown(req, ctx, filePath, admittedPath, url),
        ctx.projectId,
        {
          productionMode: false,
          branch,
          environmentName: ctx.environmentName,
          tokenProvenance: getRequestTokenProvenance(ctx.requestContext, effectiveToken),
        },
      );
    }

    if (isExtendedFSAdapter(fsAdapter) && fsAdapter.isContextualMode()) {
      if (ctx.proxyToken) {
        try {
          fsAdapter.setRequestToken(ctx.proxyToken);
        } catch (error) {
          if (!isCanonicalNotSupportedError(error)) throw error;
        }
      }

      try {
        fsAdapter.setRequestBranch(ctx.parsedDomain?.branch ?? null);
      } catch (error) {
        if (!isCanonicalNotSupportedError(error)) throw error;
      }

      try {
        fsAdapter.setProductionMode(false);
      } catch (error) {
        if (!isCanonicalNotSupportedError(error)) throw error;
      }
    }

    return await this.renderMarkdown(req, ctx, filePath, admittedPath, url);
  }

  private async renderMarkdown(
    req: Request,
    ctx: HandlerContext,
    requestedPath: string,
    admittedPath: string,
    url: URL,
  ): Promise<HandlerResult> {
    const resolveFile = ctx.adapter.fs.resolveFile;
    let resolvedPath: string | null = null;
    if (resolveFile) {
      try {
        resolvedPath = await resolveFile.call(ctx.adapter.fs, admittedPath);
      } catch (error) {
        if (!isCanonicalNotFoundError(error)) throw error;
        return await this.handleMissingMarkdown(req, ctx, requestedPath, null);
      }

      logger.debug("resolveFile result", { filePath: requestedPath, resolvedPath });
    }

    let readPath = admittedPath;
    if (resolvedPath !== null) {
      const resolvedValidation = await validatePath(resolvedPath, {
        baseDir: ctx.projectDir,
        adapter: ctx.adapter,
        level: "strict",
        allowAbsolute: true,
      });
      if (!resolvedValidation.valid || !resolvedValidation.canonicalPath) {
        logger.warn("Resolved markdown path escaped the project", {
          filePath: requestedPath,
        });
        return this.continue();
      }
      readPath = resolvedValidation.canonicalPath;
    }

    let content: string;
    try {
      content = await ctx.adapter.fs.readFile(readPath);
    } catch (error) {
      if (!isCanonicalNotFoundError(error)) throw error;
      return await this.handleMissingMarkdown(req, ctx, requestedPath, resolvedPath);
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
      logger.debug("Skipping - prose: false", { filePath: requestedPath });
      return this.continue();
    }

    const bundle = await this.compileMarkdown(
      "development",
      ctx.projectDir,
      body,
      frontmatter,
      readPath,
      "server",
    );

    const responseBuilder = this.createResponseBuilder(ctx);
    const html = this.generateHtml({
      rawHtml: bundle.rawHtml || "",
      title: frontmatter.title != null ? String(frontmatter.title) : requestedPath,
      description: frontmatter.description != null ? String(frontmatter.description) : "",
      request: req,
      url,
      projectId: ctx.projectSlug || ctx.projectId || "markdown-preview",
      filePath: requestedPath,
      nonce: responseBuilder.nonce,
    });

    responseBuilder
      .withCache("no-cache")
      .withSecurity(ctx.securityConfig ?? undefined, req);
    const response = responseBuilder.withContentType("text/html; charset=utf-8", html, HTTP_OK);

    logger.debug("Serving markdown preview", {
      filePath: requestedPath,
      htmlLength: html.length,
    });

    return this.respond(response);
  }

  private async handleMissingMarkdown(
    req: Request,
    ctx: HandlerContext,
    requestedPath: string,
    resolvedPath: string | null,
  ): Promise<HandlerResult> {
    logger.debug("File not found", { filePath: requestedPath, resolvedPath });

    const builder = this.createResponseBuilder(ctx);
    const notFoundResponse = await this.notFoundFallback(req, requestedPath, ctx, builder);
    if (notFoundResponse) return this.respond(notFoundResponse);

    return this.continue();
  }
}
