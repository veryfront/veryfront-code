import type { HandlerContext } from "../../types.ts";
import type { ResponseBuilder } from "#veryfront/security/index.ts";
import { join as joinPath } from "#veryfront/compat/path/index.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";

export async function tryNotFoundFallback(
  req: Request,
  slug: string,
  ctx: HandlerContext,
  builder: ResponseBuilder,
): Promise<Response | null> {
  try {
    const appRoot = joinPath(ctx.projectDir, "app");

    try {
      const st = await ctx.adapter.fs.stat(appRoot);
      if (!st.isDirectory) return null;
    } catch (_) {
      /* expected: app directory may not exist */
      return null;
    }

    const searchBase = slug ? joinPath(appRoot, slug) : appRoot;

    const { collectAncestorDirs, tryLoadReservedInDirs } = await import(
      "../../../../rendering/app-reserved.ts"
    );

    const dirs = await collectAncestorDirs(searchBase, appRoot);
    const contentSourceId = ctx.enriched?.contentSourceId ??
      computeContentSourceId(
        !!ctx.isLocalProject,
        ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview",
        ctx.requestContext?.branch ?? null,
        ctx.releaseId,
      );

    const NotFoundComp = await tryLoadReservedInDirs(
      dirs,
      "notFound",
      ctx.projectDir,
      "production",
      ctx.adapter,
      ctx.projectId,
      contentSourceId,
    );

    if (!NotFoundComp) return null;

    const React = await import("react");
    const { renderToStringAdapter } = await import(
      "#veryfront/react/compat/ssr-adapter/index.ts"
    );

    const element = React.createElement(NotFoundComp, {});
    let inner: string;

    try {
      inner = await renderToStringAdapter(element);
    } catch (_) {
      /* expected: SSR render may fail, fall back to text extraction */
      inner = (await extractNotFoundText(dirs, ctx)) ?? "<p>Not Found</p>";
    }

    const html =
      `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>404 Not Found</title></head><body>${inner}</body></html>`;

    return builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache("no-cache")
      .html(html, 404);
  } catch (_) {
    /* expected: entire not-found fallback may fail gracefully */
    return null;
  }
}

async function extractNotFoundText(
  dirs: string[],
  ctx: HandlerContext,
): Promise<string | null> {
  for (const dir of dirs) {
    for (
      const file of [
        joinPath(dir, "not-found.tsx"),
        joinPath(dir, "not-found.jsx"),
      ]
    ) {
      try {
        const st = await ctx.adapter.fs.stat(file);
        if (!st.isFile) continue;

        const src = await ctx.adapter.fs.readFile(file);
        const match = src.match(/>\s*([^<]+?)\s*</);

        if (match?.[1]) return `<p>${match[1]}</p>`;
      } catch (_) {
        /* expected: not-found file may not exist, try next */
      }
    }
  }

  return null;
}
