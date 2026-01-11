/**
 * Not Found Fallback Handler
 *
 * Handles App Router not-found.tsx fallback rendering.
 * Searches ancestor directories for not-found components and renders them.
 *
 * @module server/handlers/request/ssr/not-found-fallback
 */

import type { HandlerContext } from "../../types.ts";
import type { ResponseBuilder } from "@veryfront/security/index.ts";
import { join as joinPath } from "std/path/mod.ts";

/**
 * Try rendering App Router not-found.tsx fallback
 *
 * Process:
 * 1. Check if running in Deno (required for file system access)
 * 2. Verify app directory exists
 * 3. Collect ancestor directories from slug to app root
 * 4. Search for not-found.tsx/jsx in those directories
 * 5. Render the component if found
 * 6. Return 404 HTML response or null
 *
 * @param req - Incoming request
 * @param slug - Page slug (path without leading slash)
 * @param ctx - Handler context
 * @param builder - Response builder instance
 * @returns 404 Response with not-found component or null
 *
 * @example
 * ```typescript
 * const notFoundResp = await tryNotFoundFallback(req, 'blog/post-123', ctx, builder);
 * if (notFoundResp) return notFoundResp;
 * ```
 */
export async function tryNotFoundFallback(
  req: Request,
  slug: string,
  ctx: HandlerContext,
  builder: ResponseBuilder,
): Promise<Response | null> {
  try {
    // Only supported in Deno runtime for now
    const isDeno = "name" in ctx.adapter && ctx.adapter.name === "deno";
    if (!isDeno) return null;

    const appRoot = joinPath(ctx.projectDir, "app");
    try {
      const st = await ctx.adapter.fs.stat(appRoot);
      if (!st.isDirectory) return null;
    } catch {
      return null;
    }

    // Compute directory to start search from
    const searchBase = slug ? joinPath(appRoot, slug) : appRoot;
    const { collectAncestorDirs, tryLoadReservedInDirs } = await import(
      "../../../../rendering/app-reserved.ts"
    );
    const dirs = await collectAncestorDirs(searchBase, appRoot);
    const NotFoundComp = await tryLoadReservedInDirs(
      dirs,
      "notFound",
      ctx.projectDir,
      "production",
      ctx.adapter,
    );

    if (NotFoundComp) {
      // Render with compat adapter
      const React = await import("react");
      const { renderToStringAdapter } = await import(
        "@veryfront/react/compat/ssr-adapter/index.ts"
      );
      const element = React.createElement(NotFoundComp, {});
      let inner = "";
      try {
        inner = await renderToStringAdapter(element);
      } catch {
        // Fallback: extract minimal text content
        inner = (await extractNotFoundText(dirs, ctx)) || "<p>Not Found</p>";
      }

      const html =
        `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>404 Not Found</title></head><body>${inner}</body></html>`;

      return builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withCache("no-cache")
        .html(html, 404);
    }
  } catch {
    /* ignore and fall through */
  }
  return null;
}

/**
 * Extract text content from not-found.tsx/jsx files
 *
 * Fallback method when React rendering fails.
 * Reads the source file and extracts text between JSX tags.
 *
 * @param dirs - Directories to search for not-found files
 * @param ctx - Handler context
 * @returns Extracted HTML or null
 *
 * @internal
 */
async function extractNotFoundText(
  dirs: string[],
  ctx: HandlerContext,
): Promise<string | null> {
  try {
    const candidates: string[] = [];
    for (const d of dirs) {
      for (const ext of [".tsx", ".jsx"]) {
        candidates.push(joinPath(d, `not-found${ext}`));
      }
    }
    for (const f of candidates) {
      try {
        const st = await ctx.adapter.fs.stat(f);
        if (!st.isFile) continue;
        const src = await ctx.adapter.fs.readFile(f);
        const m = src.match(/>\s*([^<]+?)\s*</);
        if (m?.[1]) {
          return `<p>${m[1]}</p>`;
        }
      } catch {
        /* try next */
      }
    }
  } catch {
    /* use default */
  }
  return null;
}
