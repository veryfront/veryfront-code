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
  formatCSSError,
  generateTailwindCSS,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { DEFAULT_STYLESHEET } from "#veryfront/html/styles-builder/css-hash-cache.ts";
import { serverLogger } from "#veryfront/utils";
import { extractProjectCandidates } from "./styles-candidate-scanner.ts";

const logger = serverLogger.component("styles-css-handler");

export class StylesCSSHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "StylesCSSHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_vf_styles/styles.css", exact: true, method: "GET" }],
    enabled: () => true,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();

    try {
      return await this.withProxyContext(ctx, async () => {
        const responseBuilder = this.createResponseBuilder(ctx).withCache("no-cache");
        let rawCss: string;
        try {
          rawCss = await this.loadStylesheet(ctx);
        } catch (error) {
          logger.error("Failed to load stylesheet", {
            error: error instanceof Error ? error.message : String(error),
          });
          rawCss = DEFAULT_STYLESHEET;
        }

        let candidates: Set<string>;
        try {
          candidates = await extractProjectCandidates(ctx);
        } catch (error) {
          logger.error("Failed to extract candidates", {
            error: error instanceof Error ? error.message : String(error),
          });
          candidates = new Set<string>();
        }
        const result = await generateTailwindCSS(rawCss, candidates);

        if (result.error) {
          const formatted = formatCSSError(result.error);
          logger.error("Tailwind error", {
            error: formatted.message,
            suggestion: formatted.suggestion,
          });

          const errorMessage =
            `${formatted.title}: ${formatted.message}\nSuggestion: ${formatted.suggestion}`;
          const errorCSS = `/*
  ╔══════════════════════════════════════════════════════════════╗
  ║  TAILWIND CSS COMPILATION ERROR                               ║
  ╠══════════════════════════════════════════════════════════════╣
  ║  ${errorMessage.replace(/\n/g, "\n  ║  ")}
  ╚══════════════════════════════════════════════════════════════╝
*/

body::before {
  content: "CSS Error: ${errorMessage.replace(/"/g, '\\"').replace(/\n/g, " ")}";
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  padding: 16px;
  background: #dc2626;
  color: white;
  font-family: monospace;
  font-size: 14px;
  z-index: 99999;
  white-space: pre-wrap;
}
`;
          return this.respond(
            responseBuilder.withContentType("text/css; charset=utf-8", errorCSS, HTTP_OK),
          );
        }

        if (!result.css && candidates.size > 0) {
          logger.warn("CSS is empty despite having candidates", {
            candidates: candidates.size,
          });
        }

        logger.debug("CSS generated", {
          candidates: candidates.size,
          cssLength: result.css.length,
        });

        return this.respond(
          responseBuilder.withContentType("text/css; charset=utf-8", result.css, HTTP_OK),
        );
      });
    } catch (error) {
      // Ensure the handler never throws — an uncaught error causes the route registry
      // to skip this handler silently and fall through to the 404 handler.
      logger.error("Unhandled error in CSS handler", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      const responseBuilder = this.createResponseBuilder(ctx).withCache("no-cache");
      const errorCSS = `/* StylesCSSHandler error: ${
        (error instanceof Error ? error.message : String(error)).replace(/\*\//g, "")
      } */`;
      return this.respond(
        responseBuilder.withContentType("text/css; charset=utf-8", errorCSS, HTTP_OK),
      );
    }
  }

  private async loadStylesheet(ctx: HandlerContext): Promise<string> {
    const configuredPath = ctx.config?.tailwind?.stylesheet;

    if (configuredPath) {
      const filePath = joinPath(ctx.projectDir, configuredPath);
      return ctx.adapter.fs.readFile(filePath);
    }

    const globalsPath = joinPath(ctx.projectDir, "globals.css");
    try {
      return await ctx.adapter.fs.readFile(globalsPath);
    } catch {
      logger.debug("No stylesheet found, using default");
      return DEFAULT_STYLESHEET;
    }
  }
}
