import type { HandlerContext } from "../../types.ts";
import type { ResponseBuilder } from "#veryfront/security/index.ts";
import { join as joinPath } from "#veryfront/compat/path/index.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import {
  type DependencyPinningSnapshot,
  resolveDependencyPinningSnapshot,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";

type AppReservedModule = typeof import("../../../../rendering/app-reserved.ts");
type ReservedComponentLoader = AppReservedModule["tryLoadReservedInDirs"];

let injectedReservedComponentLoader: ReservedComponentLoader | null = null;

export function __setReservedComponentLoaderForTests(
  loader: ReservedComponentLoader | null,
): void {
  injectedReservedComponentLoader = loader;
}

export async function tryNotFoundFallback(
  req: Request,
  slug: string,
  ctx: HandlerContext,
  builder: ResponseBuilder,
  requestedDependencySnapshot?: DependencyPinningSnapshot,
): Promise<Response | null> {
  try {
    const dependencyPinningSource = createHandlerDependencyPinningSource(ctx);
    const dependencySnapshot = await resolveDependencyPinningSnapshot(
      dependencyPinningSource,
      requestedDependencySnapshot?.cacheKey,
      requestedDependencySnapshot?.dependencies,
    );
    const appRoot = joinPath(
      ctx.projectDir,
      ctx.config?.directories?.app ?? "app",
    );

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
    const loadReservedComponent = injectedReservedComponentLoader ??
      tryLoadReservedInDirs;

    const dirs = await collectAncestorDirs(searchBase, appRoot);
    const reactVersion = await resolveProjectReactVersion({
      projectDir: ctx.projectDir,
      config: ctx.config,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
      dependencyPinningDependencies: dependencySnapshot.dependencies,
      dependencyPinningSource,
    });
    // Server-trusted request environment. `resolvedEnvironment` and
    // `requestContext.mode` are both settled before the handler runs and are
    // never taken from a client-supplied header or query parameter, so reading
    // them here cannot let a caller force preview instrumentation onto a
    // production render (VULN-SRV-1 / VULN-SRV-2).
    //
    // One value drives both the content source and the instrumentation, so a
    // cache entry can never disagree with how it was built. The "preview" tail
    // is the platform-wide convention for an unresolved environment, the same
    // one that already picks the cache strategy and the no-cache headers.
    const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview";
    const contentSourceId = ctx.enriched?.contentSourceId ??
      computeContentSourceId(
        !!ctx.isLocalProject,
        environment,
        ctx.requestContext?.branch ?? null,
        ctx.releaseId,
      );

    const NotFoundComp = await loadReservedComponent(
      dirs,
      "notFound",
      ctx.projectDir,
      {
        compileMode: ctx.isLocalProject ? "development" : "production",
        environment,
      },
      ctx.adapter,
      ctx.projectId,
      contentSourceId,
      reactVersion,
      dependencySnapshot.cacheKey,
      dependencySnapshot.dependencies,
      dependencyPinningSource,
      new URL(req.url).origin,
    );

    if (!NotFoundComp) return null;

    const { getProjectReact, renderToStringAdapter } = await import(
      "#veryfront/react/compat/ssr-adapter/index.ts"
    );
    const React = await getProjectReact(reactVersion, ctx.adapter);

    const element = React.createElement(NotFoundComp, {});
    let inner: string;

    try {
      const rendered = await runWithHeadCollector(
        (renderContext) =>
          renderToStringAdapter(element, {
            nonce: builder.nonce,
            renderContext,
            reactVersion,
          }, ctx.adapter),
        { nonce: builder.nonce },
      );
      inner = rendered.result;
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
