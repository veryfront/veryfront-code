/**
 * Styles CSS Handler
 *
 * Serves Tailwind CSS compiled from user's stylesheet + all project source files.
 * Extracts candidates from ALL source files to ensure HMR includes new classes.
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { joinPath } from "#veryfront/utils/path-utils.ts";
import {
  extractCandidates,
  generateTailwindCSS,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { serverLogger as logger } from "#veryfront/utils";

const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];

export class StylesCSSHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "StylesCSSHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_vf_styles/styles.css", exact: true, method: "GET" }],
    enabled: () => true,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    return await this.withProxyContext(ctx, async () => {
      const responseBuilder = this.createResponseBuilder(ctx).withCache("no-cache");
      const rawCss = await this.loadStylesheet(ctx);

      const candidates = await this.extractProjectCandidates(ctx);
      const result = await generateTailwindCSS(rawCss, candidates);

      if (result.error) {
        logger.error("[StylesCSSHandler] Tailwind error", { error: result.error });
      }

      logger.debug("[StylesCSSHandler] CSS generated", {
        candidates: candidates.size,
        cssLength: result.css.length,
      });

      return this.respond(
        responseBuilder.withContentType("text/css; charset=utf-8", result.css, HTTP_OK),
      );
    });
  }

  private async loadStylesheet(ctx: HandlerContext): Promise<string> {
    const configuredPath = ctx.config?.tailwind?.stylesheet;

    // If user explicitly configured a stylesheet, it must exist
    if (configuredPath) {
      const filePath = joinPath(ctx.projectDir, configuredPath);
      return await ctx.adapter.fs.readFile(filePath);
    }

    // Try default globals.css
    const globalsPath = joinPath(ctx.projectDir, "globals.css");
    try {
      return await ctx.adapter.fs.readFile(globalsPath);
    } catch {
      // No stylesheet found, use default Tailwind import
      logger.debug("[StylesCSSHandler] No stylesheet found, using default");
      return '@import "tailwindcss";';
    }
  }

  private async extractProjectCandidates(ctx: HandlerContext): Promise<Set<string>> {
    const candidates = new Set<string>();

    const wrappedFs = ctx.adapter.fs as unknown as {
      getUnderlyingAdapter?: () => unknown;
    };

    if (typeof wrappedFs.getUnderlyingAdapter !== "function") {
      logger.warn(
        "[StylesCSSHandler] FS adapter wrapper missing getUnderlyingAdapter, CSS will have no utility classes",
      );
      return candidates;
    }

    const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
      getAllSourceFiles?: () =>
        | Array<{ path: string; content?: string }>
        | Promise<Array<{ path: string; content?: string }>>;
    };

    if (typeof fsAdapter.getAllSourceFiles !== "function") {
      logger.warn(
        "[StylesCSSHandler] FS adapter missing getAllSourceFiles, CSS will have no utility classes",
      );
      return candidates;
    }

    const files = await fsAdapter.getAllSourceFiles();

    for (const file of files) {
      if (!file.content) continue;
      if (!SOURCE_EXTENSIONS.some((ext) => file.path.endsWith(ext))) continue;

      for (const cls of extractCandidates(file.content)) {
        candidates.add(cls);
      }
    }

    // Safelist: prose classes for markdown compiler (requires @tailwindcss/typography)
    candidates.add("prose");
    candidates.add("dark:prose-invert");

    return candidates;
  }
}
