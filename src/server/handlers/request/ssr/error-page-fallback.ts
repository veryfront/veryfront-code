import type * as React from "react";
import type { HandlerContext } from "../../types.ts";
import type { ResponseBuilder } from "#veryfront/security/index.ts";
import type { CacheRepository } from "#veryfront/repositories/types.ts";
import { join as joinPath } from "#veryfront/compat/path/index.ts";
import { serverLogger } from "#veryfront/utils";
import { buildErrorPageCacheKey } from "#veryfront/cache";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { generateErrorHtml } from "../../../utils/error-html.ts";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import {
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveDependencyPinningSnapshot,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import { addNonceToHtmlTags } from "#veryfront/html/nonce-injection.ts";

const logger = serverLogger.component("error-page-fallback");

type ErrorPageType = "404" | "500" | "_error";
type ComponentLoaderModule = typeof import("#veryfront/modules/react-loader/component-loader.ts");
type ComponentSourceLoader = ComponentLoaderModule["loadComponentFromSource"];

interface ErrorPageOptions {
  statusCode: number;
  error?: Error;
  pathname?: string;
}

/** Injected cache repository for testing */
let injectedCacheRepo: CacheRepository<string> | null = null;
let injectedComponentSourceLoader: ComponentSourceLoader | null = null;

/**
 * Inject a CacheRepository for testing.
 * Call with null to restore default Map-based caching.
 */
export function __injectCacheForTests(
  cacheRepo: CacheRepository<string> | null,
): void {
  injectedCacheRepo = cacheRepo;
}

export function __setComponentSourceLoaderForTests(
  loader: ComponentSourceLoader | null,
): void {
  injectedComponentSourceLoader = loader;
}

export async function tryErrorPageFallback(
  req: Request,
  ctx: HandlerContext,
  builder: ResponseBuilder,
  options: ErrorPageOptions,
  requestedDependencySnapshot?: DependencyPinningSnapshot,
): Promise<Response | null> {
  const { statusCode, error, pathname } = options;

  try {
    const dependencyPinningSource = createHandlerDependencyPinningSource(ctx);
    const dependencySnapshot = await resolveDependencyPinningSnapshot(
      dependencyPinningSource,
      requestedDependencySnapshot?.cacheKey,
      requestedDependencySnapshot?.dependencies,
    );
    const pagesDir = joinPath(
      ctx.projectDir,
      ctx.config?.directories?.pages ?? "pages",
    );

    try {
      const st = await ctx.adapter.fs.stat(pagesDir);
      if (!st.isDirectory) return null;
    } catch (_) {
      // expected: pages directory doesn't exist
      return null;
    }

    const reactVersion = await resolveProjectReactVersion({
      projectDir: ctx.projectDir,
      config: ctx.config,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
      dependencyPinningDependencies: dependencySnapshot.dependencies,
      dependencyPinningSource,
    });

    const specificPage: ErrorPageType | null = statusCode === 404
      ? "404"
      : statusCode === 500
      ? "500"
      : null;

    if (specificPage) {
      const ErrorComponent = await tryLoadErrorPage(
        pagesDir,
        specificPage,
        ctx,
        reactVersion,
        dependencySnapshot,
        dependencyPinningSource,
        new URL(req.url).origin,
      );
      if (ErrorComponent) {
        logger.debug(`Found pages/${specificPage}.tsx`);
        return renderErrorPage(
          req,
          ctx,
          builder,
          ErrorComponent,
          statusCode,
          error,
          pathname,
          reactVersion,
        );
      }
    }

    const GenericErrorComponent = await tryLoadErrorPage(
      pagesDir,
      "_error",
      ctx,
      reactVersion,
      dependencySnapshot,
      dependencyPinningSource,
      new URL(req.url).origin,
    );
    if (!GenericErrorComponent) return null;

    logger.debug("Found pages/_error.tsx");
    return renderErrorPage(
      req,
      ctx,
      builder,
      GenericErrorComponent,
      statusCode,
      error,
      pathname,
      reactVersion,
    );
  } catch (e) {
    // The user's custom error page failed to compile/load. Surface at warn so
    // they learn it's broken, before falling back to the default error output.
    logger.warn("Failed to load custom error page; falling back to default", {
      errorName: e instanceof Error ? e.name : typeof e,
    });
    return null;
  }
}

const ERROR_PAGE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const;
/** Special value to indicate "not found" in cache (distinguishes from cache miss) */
const CACHE_NOT_FOUND = "__NOT_FOUND__";

const errorPagePathCache = new LRUCacheAdapter({ maxEntries: 1000 });

async function getCachedPath(
  cacheKey: string,
): Promise<string | null | undefined> {
  if (!injectedCacheRepo) return errorPagePathCache.get<string | null>(cacheKey);

  const cached = await injectedCacheRepo.get(cacheKey);
  if (cached === CACHE_NOT_FOUND) return null;
  return cached || undefined;
}

async function setCachedPath(cacheKey: string, path: string | null): Promise<void> {
  if (injectedCacheRepo) {
    await injectedCacheRepo.set(cacheKey, path ?? CACHE_NOT_FOUND);
    return;
  }
  errorPagePathCache.set(cacheKey, path);
}

/**
 * Whether a "this project has no error page" answer may be cached.
 *
 * In dev it may not. Nothing invalidates this cache when the filesystem
 * changes, so caching the miss means a project that adds `pages/500.tsx` while
 * the server is running keeps getting the dev overlay until restart, with no
 * indication why. A miss costs one file probe on an error render, which is not
 * a path worth optimising in dev.
 */
function canCacheMiss(ctx: HandlerContext): boolean {
  return !ctx.isLocalProject;
}

async function setCachedMiss(cacheKey: string, ctx: HandlerContext): Promise<void> {
  if (!canCacheMiss(ctx)) return;
  await setCachedPath(cacheKey, null);
}

async function deleteCachedPath(cacheKey: string): Promise<void> {
  if (injectedCacheRepo) {
    await injectedCacheRepo.delete(cacheKey);
    return;
  }
  errorPagePathCache.delete(cacheKey);
}

async function tryLoadErrorPage(
  pagesDir: string,
  pageType: ErrorPageType,
  ctx: HandlerContext,
  reactVersion: string,
  dependencySnapshot: DependencyPinningSnapshot,
  dependencyPinningSource: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
): Promise<React.ComponentType<unknown> | null> {
  const cacheKey = buildErrorPageCacheKey(ctx.projectId, ctx.projectDir, pageType);

  const cachedPath = await getCachedPath(cacheKey);
  if (cachedPath !== undefined) {
    if (!cachedPath) return null;

    try {
      return await loadErrorComponent(
        cachedPath,
        ctx,
        reactVersion,
        dependencySnapshot,
        dependencyPinningSource,
        moduleServerOrigin,
      );
    } catch (_) {
      // expected: cached path no longer valid, clear and re-resolve
      await deleteCachedPath(cacheKey);
    }
  }

  const basePath = joinPath(pagesDir, pageType);

  if (ctx.adapter.fs.resolveFile) {
    try {
      const resolvedPath = await ctx.adapter.fs.resolveFile(basePath);
      if (!resolvedPath) {
        await setCachedMiss(cacheKey, ctx);
        return null;
      }

      const fullPath = joinPath(ctx.projectDir, resolvedPath);
      const component = await loadErrorComponent(
        fullPath,
        ctx,
        reactVersion,
        dependencySnapshot,
        dependencyPinningSource,
        moduleServerOrigin,
      );
      if (component) {
        await setCachedPath(cacheKey, fullPath);
        return component;
      }
    } catch (_) {
      // expected: resolveFile may fail, fall through to extension probing
    }

    await setCachedMiss(cacheKey, ctx);
    return null;
  }

  for (const ext of ERROR_PAGE_EXTENSIONS) {
    const filePath = joinPath(pagesDir, `${pageType}${ext}`);
    try {
      const stat = await ctx.adapter.fs.stat(filePath);
      if (!stat.isFile) continue;

      const component = await loadErrorComponent(
        filePath,
        ctx,
        reactVersion,
        dependencySnapshot,
        dependencyPinningSource,
        moduleServerOrigin,
      );
      if (component) {
        await setCachedPath(cacheKey, filePath);
        return component;
      }
    } catch (_) {
      // expected: file with this extension doesn't exist
    }
  }

  await setCachedMiss(cacheKey, ctx);
  return null;
}

async function loadErrorComponent(
  filePath: string,
  ctx: HandlerContext,
  reactVersion: string,
  dependencySnapshot: DependencyPinningSnapshot,
  dependencyPinningSource: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
): Promise<React.ComponentType<unknown> | null> {
  const src = await ctx.adapter.fs.readFile(filePath);
  const loadComponentFromSource = injectedComponentSourceLoader ??
    (await import(
      "#veryfront/modules/react-loader/component-loader.ts"
    )).loadComponentFromSource;

  const isLocal = !!ctx.isLocalProject;
  const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview";
  const contentSourceId = ctx.enriched?.contentSourceId ??
    computeContentSourceId(
      isLocal,
      environment,
      ctx.requestContext?.branch ?? null,
      ctx.releaseId,
    );

  const Component = await loadComponentFromSource(
    src,
    filePath,
    ctx.projectDir,
    ctx.adapter,
    {
      projectId: ctx.projectId ?? ctx.projectDir,
      dev: isLocal,
      contentSourceId,
      reactVersion,
      serverExternalPackages: ctx.config?.build?.serverExternalPackages,
      moduleServerOrigin,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
      dependencyPinningDependencies: dependencySnapshot.dependencies,
      dependencyPinningSource,
      mode: environment,
    },
  );

  return typeof Component === "function" ? (Component as React.ComponentType<unknown>) : null;
}

async function renderErrorPage(
  req: Request,
  ctx: HandlerContext,
  builder: ResponseBuilder,
  ErrorComponent: React.ComponentType<unknown>,
  statusCode: number,
  error?: Error,
  pathname?: string,
  reactVersion?: string,
): Promise<Response> {
  const { getProjectReact, renderToStringAdapter } = await import(
    "#veryfront/react/compat/ssr-adapter/index.ts"
  );
  const React = await getProjectReact(reactVersion, ctx.adapter);

  const errorProps = { statusCode, err: error, pathname };

  const element = React.createElement(
    ErrorComponent as React.ComponentType<typeof errorProps>,
    errorProps,
  );

  try {
    const { result: inner } = await runWithHeadCollector(
      (renderContext) =>
        renderToStringAdapter(element as React.ReactElement, {
          nonce: builder.nonce,
          renderContext,
          reactVersion,
        }, ctx.adapter),
      { nonce: builder.nonce },
    );

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${statusCode} Error</title>
</head>
<body>${inner}</body>
</html>`;

    return builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache("no-cache")
      .html(html, statusCode);
  } catch (renderError) {
    logger.debug("Failed to render error component", {
      error: renderError,
    });

    const title = statusCode === 404 ? "Not Found" : "Server Error";
    let message = "An unexpected error occurred.";
    if (statusCode === 404) {
      message = pathname ? `The page "${pathname}" could not be found.` : "Page not found.";
    }

    const fallbackHtml = generateErrorHtml({
      statusCode,
      title,
      message,
      minimal: true,
    });

    return builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache("no-cache")
      .html(addNonceToHtmlTags(fallbackHtml, builder.nonce), statusCode);
  }
}
