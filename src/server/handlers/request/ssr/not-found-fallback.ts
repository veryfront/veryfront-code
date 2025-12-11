
import type { HandlerContext } from "../../types.ts";
import type { ResponseBuilder } from "@veryfront/security/index.ts";
import { join as joinPath } from "std/path/mod.ts";

export async function tryNotFoundFallback(
  req: Request,
  slug: string,
  ctx: HandlerContext,
  builder: ResponseBuilder,
): Promise<Response | null> {
  try {
    const isDeno = "name" in ctx.adapter && ctx.adapter.name === "deno";
    if (!isDeno) return null;

    const appRoot = joinPath(ctx.projectDir, "app");
    try {
      const st = await ctx.adapter.fs.stat(appRoot);
      if (!st.isDirectory) return null;
    } catch {
      return null;
    }

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
      const React = await import("react");
      const { renderToStringAdapter } = await import(
        "@veryfront/react/compat/ssr-adapter/index.ts"
      );
      const element = React.createElement(NotFoundComp, {});
      let inner = "";
      try {
        inner = await renderToStringAdapter(element as any);
      } catch {
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
  }
  return null;
}

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
      }
    }
  } catch {
  }
  return null;
}
