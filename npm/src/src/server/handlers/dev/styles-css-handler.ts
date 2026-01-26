/**
 * Styles CSS Handler
 *
 * Serves Tailwind CSS compiled from user's stylesheet + all project source files.
 * Extracts candidates from ALL source files to ensure HMR includes new classes.
 */
import * as dntShim from "../../../../_dnt.shims.js";


import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.js";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "../../../utils/constants/index.js";
import { joinPath } from "../../../utils/path-utils.js";
import {
  extractCandidates,
  generateTailwindCSS,
} from "../../../html/styles-builder/tailwind-compiler.js";
import { serverLogger as logger } from "../../../utils/index.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
import { join } from "../../../platform/compat/path/index.js";

const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];

export class StylesCSSHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "StylesCSSHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_vf_styles/styles.css", exact: true, method: "GET" }],
    enabled: () => true,
  };

  async handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult> {
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
        // Surface error in CSS so developers can see it
        const errorCSS = `/*
  ╔══════════════════════════════════════════════════════════════╗
  ║  TAILWIND CSS COMPILATION ERROR                               ║
  ╠══════════════════════════════════════════════════════════════╣
  ║  ${result.error.replace(/\n/g, "\n  ║  ")}
  ╚══════════════════════════════════════════════════════════════╝
*/

body::before {
  content: "CSS Error: ${result.error.replace(/"/g, '\\"').replace(/\n/g, " ")}";
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

      // Warn if CSS is unexpectedly empty (no error but no output)
      if (!result.css && candidates.size > 0) {
        logger.warn("[StylesCSSHandler] CSS is empty despite having candidates", {
          candidates: candidates.size,
        });
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
      return `@import "tailwindcss";
@custom-variant dark (&:is(.dark, [data-theme="dark"]) *, &:is(.dark, [data-theme="dark"]));`;
    }
  }

  private async extractProjectCandidates(ctx: HandlerContext): Promise<Set<string>> {
    const candidates = new Set<string>();

    const wrappedFs = ctx.adapter.fs as unknown as {
      getUnderlyingAdapter?: () => unknown;
    };

    if (typeof wrappedFs.getUnderlyingAdapter !== "function") {
      // Fallback: scan local files directly for local development
      logger.debug(
        "[StylesCSSHandler] No FS adapter wrapper, falling back to local file scanning",
      );
      return await this.scanLocalFiles(ctx.projectDir, ctx);
    }

    const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
      getAllSourceFiles?: () =>
        | Array<{ path: string; content?: string }>
        | Promise<Array<{ path: string; content?: string }>>;
    };

    if (typeof fsAdapter.getAllSourceFiles !== "function") {
      // Fallback: scan local files directly for local development
      logger.debug(
        "[StylesCSSHandler] FS adapter missing getAllSourceFiles, falling back to local file scanning",
      );
      return await this.scanLocalFiles(ctx.projectDir, ctx);
    }

    const files = await fsAdapter.getAllSourceFiles();

    for (const file of files) {
      if (!file.content) continue;
      if (!SOURCE_EXTENSIONS.some((ext) => file.path.endsWith(ext))) continue;

      for (const cls of extractCandidates(file.content)) {
        candidates.add(cls);
      }
    }

    return candidates;
  }

  /**
   * Fallback: scan local files for Tailwind candidates when no FS adapter is available.
   * Used in local development mode where projects are read directly from disk.
   */
  private async scanLocalFiles(projectDir: string, ctx: HandlerContext): Promise<Set<string>> {
    const candidates = new Set<string>();
    const fs = createFileSystem();
    const SKIP_DIRS = new Set(["node_modules", ".cache", ".git", "dist", "build", ".vscode"]);

    const scanDir = async (dir: string): Promise<void> => {
      try {
        for await (const entry of fs.readDir(dir)) {
          const fullPath = join(dir, entry.name);

          if (entry.isDirectory) {
            if (!SKIP_DIRS.has(entry.name)) {
              await scanDir(fullPath);
            }
            continue;
          }

          if (!entry.isFile) continue;
          if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;

          try {
            const content = await ctx.adapter.fs.readFile(fullPath);
            for (const cls of extractCandidates(content)) {
              candidates.add(cls);
            }
          } catch {
            // Skip files that can't be read
          }
        }
      } catch {
        // Skip directories that can't be read
      }
    };

    try {
      await scanDir(projectDir);

      logger.debug("[StylesCSSHandler] Local file scan complete", {
        projectDir,
        candidates: candidates.size,
      });
    } catch (error) {
      logger.warn("[StylesCSSHandler] Failed to scan local files", {
        projectDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return candidates;
  }
}
