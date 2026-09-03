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
import { hasMatchingEtag } from "../utils/etag.ts";
import { hashCSS } from "#veryfront/html/styles-builder/css-identity.ts";
import {
  acquireCSSGenerationSession,
  type CSSGenerationSession,
  formatCSSError,
  getCSSByHashAsync,
  getProjectCSS,
  regenerateCSSByHash,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import {
  composeCSSStyleProfileHash,
  hashCandidates,
} from "#veryfront/html/styles-builder/css-identity.ts";
import {
  createPreparedProjectCSSContext,
  type PreparedProjectCSSRequestContext,
  storePreparedProjectCSS,
  tryGetPreparedProjectCSS,
} from "#veryfront/html/styles-builder/prepared-project-css-cache.ts";
import { serverLogger } from "#veryfront/utils";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type {
  EnsureStyleArtifactBuildInput,
  ResolveStyleArtifactInput,
  VeryfrontApiClient,
} from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import { extractProjectCandidates } from "./styles-candidate-scanner.ts";
import { resolveScanCacheIdentity, type ScanCacheIdentity } from "./styles-scan-cache.ts";
import { findStylesheetFromFiles } from "#veryfront/html/styles-builder/css-pregeneration.ts";
import { extractProjectCssImports } from "./styles-css-import-scanner.ts";
import { mergeImportedCSS } from "#veryfront/rendering/orchestrator/html-imported-css.ts";
import { profilePhase } from "#veryfront/observability";

const logger = serverLogger.component("styles-css-handler");

type GeneratedStylesResult = Awaited<ReturnType<typeof getProjectCSS>>;
type StyleArtifactSelectorContext = Omit<ResolveStyleArtifactInput, "styleProfileHash">;

/** Longest diagnostic text embedded in a served stylesheet. */
const MAX_DIAGNOSTIC_LENGTH = 2_000;
const SUCCESSFUL_CSS_CACHE = { maxAge: 0, mustRevalidate: true } as const;

/**
 * Neutralize the only sequence that can terminate a CSS comment (a star
 * followed by a slash). Diagnostic text is derived from project-controlled
 * input (a stylesheet's `@plugin` name reaches the message verbatim), so
 * leaving that sequence intact would close the banner early and let the rest
 * of the message be parsed as CSS rules.
 */
function forCSSComment(value: string): string {
  return value.replaceAll("*/", "* /");
}

/**
 * Escape text for a double-quoted CSS string. Backslash must be escaped first
 * or it would re-escape the quotes added afterwards, and newlines terminate a
 * CSS string literal outright.
 */
function forCSSString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    // deno-lint-ignore no-control-regex -- raw control characters terminate a CSS string.
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
}

function clampDiagnostic(value: string): string {
  const text = typeof value === "string" ? value : String(value);
  return text.length > MAX_DIAGNOSTIC_LENGTH ? `${text.slice(0, MAX_DIAGNOSTIC_LENGTH)}…` : text;
}

/**
 * Render a stylesheet that both explains the failure in the source and shows
 * it in the page. Every error path serves this: a stylesheet that failed to
 * build must never be mistaken for a project that simply has no styles.
 *
 * Exported for direct testing. The escaping contract cannot be fully driven
 * through the handler: a `"` inside `@plugin "..."` closes the CSS string
 * before it ever reaches a diagnostic, so the string-literal escape path has
 * no end-to-end route and must be exercised here.
 */
export function renderCSSDiagnostic(
  heading: string,
  detail: { title: string; message: string; suggestion: string },
): string {
  const summary = clampDiagnostic(
    `${detail.title}: ${detail.message}\nSuggestion: ${detail.suggestion}`,
  );
  return `/*
  ${forCSSComment(heading)}
  ${forCSSComment(summary).replaceAll("\n", "\n  ")}
*/

body::before {
  content: "CSS Error: ${forCSSString(summary.replaceAll("\n", " "))}";
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
}

export class StylesCSSHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "StylesCSSHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [{ pattern: "/_vf_styles/styles.css", exact: true, method: "GET" }],
    enabled: () => true,
  };

  /**
   * Serve a generated stylesheet with a validator.
   *
   * The route is `Cache-Control: no-cache`, so the browser revalidates before
   * every use. Without an ETag that revalidation is a full download; with one it
   * is a 304. This is the only place a CSS body becomes a response, so the
   * validator is attached here rather than at each call site.
   */
  private respondCSS(
    builder: ReturnType<BaseHandler["createResponseBuilder"]>,
    req: Request,
    css: string,
  ): HandlerResult {
    const etag = `"${hashCSS(css)}"`;
    if (hasMatchingEtag(req, etag)) {
      return this.respond(builder.notModified(etag));
    }
    return this.respond(
      builder.withETag(etag).withContentType("text/css; charset=utf-8", css, HTTP_OK),
    );
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();

    try {
      return await this.withProxyContext(ctx, async () => {
        const responseBuilder = this.createResponseBuilder(ctx).withCache(SUCCESSFUL_CSS_CACHE);
        // Key the prepared-CSS and compiled-CSS caches on the same resolved
        // identity the scans use. Keying them on `ctx.projectSlug` and the
        // request's own release/branch selectors let an unauthenticated client
        // vary `x-project-slug` (or the Host-parsed subdomain) on a standalone
        // server to miss both caches and force a full Tailwind compile per
        // request, on a route that is public and exempt from the concurrency
        // limiter. `resolveScanCacheIdentity` admits a slug only behind the
        // proxy boundary and otherwise names the directory actually served.
        const scanIdentity = resolveScanCacheIdentity(ctx);
        const projectScope = scanIdentity.scope;
        const styleProfile = scanIdentity.styleProfile;
        const contentContext = this.getContentContext(ctx);
        let rawCss = await profilePhase("css.load_stylesheet", () => this.loadStylesheet(ctx));
        // Production SSR merges CSS imported by modules (`import "./styles.css"`
        // in a layout) into the page stylesheet during module loading. This
        // route has no module-loading pass, so discover those imports from the
        // project sources and merge them here. Runs before the prepared-CSS
        // context is created so cache keys reflect the merged stylesheet.
        try {
          const cssImports = await profilePhase(
            "css.scan_css_imports",
            () => extractProjectCssImports(ctx),
          );
          if (cssImports.length > 0) {
            const merged = await profilePhase(
              "css.merge_imported_css",
              () =>
                mergeImportedCSS({
                  fs: ctx.adapter.fs,
                  logger,
                  projectDir: ctx.projectDir,
                  globalCSS: rawCss ?? "",
                  cssImports,
                  stylesheetPath: ctx.config?.tailwind?.stylesheet ?? "globals.css",
                }),
            );
            if (merged) rawCss = merged;
          }
        } catch (error) {
          logger.error("Failed to merge module CSS imports", {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }

        let candidates: Set<string>;
        try {
          candidates = await profilePhase(
            "css.extract_candidates",
            () => extractProjectCandidates(ctx),
          );
        } catch (error) {
          logger.error("Failed to extract candidates", {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
        const generationSession = acquireCSSGenerationSession(false);
        const resolvedCss = rawCss ?? generationSession.compilationSession.defaultStylesheet;
        const artifactStyleProfileHash = composeCSSStyleProfileHash(
          styleProfile.hash,
          generationSession.cacheIdentity,
        );
        const preparedContext = this.createPreparedCSSContext(
          scanIdentity,
          resolvedCss,
          candidates,
          generationSession,
          artifactStyleProfileHash,
        );

        if (preparedContext) {
          const prepared = await profilePhase(
            "css.prepared_cache_lookup",
            () => tryGetPreparedProjectCSS(preparedContext),
          );
          if (prepared) {
            logger.debug("Prepared CSS cache hit", {
              projectScope,
              projectVersion: preparedContext.projectVersion,
              styleProfileHash: artifactStyleProfileHash,
              cssHash: prepared.hash,
            });

            return this.respondCSS(responseBuilder, req, prepared.css);
          }
        }

        const remotePrepared = await profilePhase(
          "css.remote_artifact_lookup",
          () =>
            this.tryResolveRemotePreparedCSS(
              ctx,
              projectScope,
              artifactStyleProfileHash,
              contentContext,
              preparedContext,
            ),
        );
        if (remotePrepared) {
          logger.debug("Prepared CSS resolved via style artifact metadata", {
            projectScope,
            styleProfileHash: artifactStyleProfileHash,
            cssHash: remotePrepared.hash,
          });

          return this.respondCSS(responseBuilder, req, remotePrepared.css);
        }

        let result: GeneratedStylesResult;
        try {
          result = await profilePhase(
            "css.generate_stylesheet",
            () => this.generateStylesheet(projectScope, resolvedCss, candidates, generationSession),
          );
        } catch (error) {
          const formatted = formatCSSError(error instanceof Error ? error : String(error));
          logger.error("Tailwind error", {
            error: formatted.message,
            suggestion: formatted.suggestion,
          });

          return this.respond(
            responseBuilder.withContentType(
              "text/css; charset=utf-8",
              renderCSSDiagnostic("TAILWIND CSS COMPILATION ERROR", formatted),
              HTTP_OK,
            ),
          );
        }

        if (!result.css && candidates.size > 0) {
          logger.warn("CSS is empty despite having candidates", {
            candidates: candidates.size,
          });
        }

        logger.debug("CSS generated", {
          projectScope,
          candidates: candidates.size,
          cssLength: result.css.length,
          fromCache: "fromCache" in result ? result.fromCache : false,
          cssHash: "hash" in result ? result.hash : undefined,
        });

        if (preparedContext && "hash" in result) {
          await profilePhase(
            "css.store_prepared",
            () =>
              storePreparedProjectCSS(preparedContext, {
                css: result.css,
                hash: result.hash,
              }),
          );
        }

        if ("hash" in result) {
          await this.registerPreparedCSSArtifact(
            ctx,
            artifactStyleProfileHash,
            contentContext,
            result.hash,
          );
        }

        return this.respondCSS(responseBuilder, req, result.css);
      });
    } catch (error) {
      // Ensure the handler never throws: an uncaught error causes the route registry
      // to skip this handler silently and fall through to the 404 handler.
      logger.error("Unhandled error in CSS handler", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // This path used to answer with a bare CSS comment: 200, zero rules, no
      // visible signal. A stylesheet that failed to build is indistinguishable
      // from a project that legitimately has no styles, so the page renders
      // completely unstyled and nothing in the browser says why. Route it
      // through the same visible diagnostic the compile path uses.
      //
      // The message stays generic. The compile path's text comes from the
      // project's own stylesheet and is the whole point of this route. This
      // catch instead fires on infrastructure faults (adapter, filesystem,
      // network) whose messages carry server-side paths and internals, and a
      // preview URL is shareable. The detail is logged above instead.
      const responseBuilder = this.createResponseBuilder(ctx).withCache("no-cache");
      return this.respond(
        responseBuilder.withContentType(
          "text/css; charset=utf-8",
          renderCSSDiagnostic("STYLESHEET COULD NOT BE BUILT", {
            title: "CSS Handler Error",
            message: "The stylesheet could not be built for this request.",
            suggestion: "Check the server logs for this request's error and stack trace.",
          }),
          HTTP_OK,
        ),
      );
    }
  }

  /**
   * Resolve the project stylesheet the same way the production pipeline does.
   *
   * Production calls `findStylesheetFromFiles` over the loaded source files,
   * which accepts `globals.css`, `global.css`, `styles/globals.css` and
   * `app/globals.css`. This route used to read a single hardcoded
   * `<projectDir>/globals.css` through the filesystem adapter, so a project
   * whose stylesheet sits anywhere else silently fell back to the provider
   * default and lost its `@theme` tokens -- every `bg-<token>` utility the
   * theme defines then fails to generate, and the preview renders unstyled
   * while production is fine.
   *
   * Resolving from the same file list also removes the dependency on a
   * path-shaped filesystem read, which is not how sources arrive when they are
   * served from the control plane rather than local disk.
   */
  private async loadStylesheet(ctx: HandlerContext): Promise<string | undefined> {
    const configuredPath = ctx.config?.tailwind?.stylesheet;

    const files = await this.getSourceFiles(ctx);
    if (files) {
      const fromFiles = findStylesheetFromFiles(files, configuredPath);
      if (fromFiles) return fromFiles;
    }

    // No source list available (or nothing matched): fall back to reading the
    // configured path, then the conventional locations, directly.
    const candidatePaths = configuredPath
      ? [configuredPath]
      : ["globals.css", "global.css", "styles/globals.css", "app/globals.css"];

    for (const candidate of candidatePaths) {
      try {
        const contents = await ctx.adapter.fs.readFile(joinPath(ctx.projectDir, candidate));
        if (contents) return contents;
      } catch (_) {
        /* try the next conventional location */
      }
    }

    // Worth a warning rather than a debug line: the page still renders, but
    // without the project's theme, which looks like a broken site.
    logger.warn("No project stylesheet found; provider default will be used", {
      projectDir: ctx.projectDir,
      configuredPath: configuredPath ?? null,
    });
    return undefined;
  }

  private async getSourceFiles(
    ctx: HandlerContext,
  ): Promise<Array<{ path: string; content?: string }> | null> {
    const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
    if (typeof wrappedFs.getUnderlyingAdapter !== "function") return null;

    const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
      getAllSourceFiles?: () => Promise<Array<{ path: string; content?: string }>>;
    };
    if (typeof fsAdapter.getAllSourceFiles !== "function") return null;

    try {
      return await fsAdapter.getAllSourceFiles();
    } catch (_) {
      return null;
    }
  }

  private generateStylesheet(
    projectScope: string,
    rawCss: string,
    candidates: Set<string>,
    generationSession: CSSGenerationSession,
  ): Promise<GeneratedStylesResult> {
    return getProjectCSS(projectScope, rawCss, candidates, {
      minify: generationSession.minify,
      environment: "preview",
      buildMode: "production",
    }, { generationSession });
  }

  private getContentContext(ctx: HandlerContext): ResolvedContentContext | null {
    const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
    if (typeof wrappedFs.getUnderlyingAdapter !== "function") return null;

    const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
      getContentContext?: () => ResolvedContentContext | null;
    };

    return typeof fsAdapter.getContentContext === "function" ? fsAdapter.getContentContext() : null;
  }

  private getVeryfrontApiClient(ctx: HandlerContext): VeryfrontApiClient | null {
    const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
    if (typeof wrappedFs.getUnderlyingAdapter !== "function") return null;

    const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
      getClient?: () => VeryfrontApiClient;
    };

    return typeof fsAdapter.getClient === "function" ? fsAdapter.getClient() : null;
  }

  private createPreparedCSSContext(
    identity: ScanCacheIdentity,
    rawCss: string,
    candidates: Set<string>,
    generationSession: CSSGenerationSession,
    styleProfileHash: string,
  ) {
    if (!identity.scope) return undefined;

    // Scope and version both come from the resolved identity, so the prepared
    // entry names the source tree this request actually reads rather than the
    // selectors it claims. A request that resolves no content context on a
    // standalone server keys on `ctx.projectDir` and the `live` version; the
    // entry stays correct because its key also covers the stylesheet text and
    // the candidate hash, both of which change when the sources do.
    return createPreparedProjectCSSContext(
      identity.scope,
      identity.version,
      rawCss,
      styleProfileHash,
      {
        cssPipelineIdentity: generationSession.cacheIdentity,
        candidatesHash: hashCandidates(candidates),
        minify: generationSession.minify,
        environment: "preview",
        buildMode: "production",
      },
    );
  }

  private resolveStyleArtifactSelector(
    contentContext: ResolvedContentContext | null,
    ctx: HandlerContext,
  ): StyleArtifactSelectorContext | null {
    if (contentContext?.sourceType === "branch" && contentContext.branch) {
      return {
        branch: contentContext.branch,
      };
    }

    if (contentContext?.sourceType === "environment" && contentContext.environmentName) {
      return {
        environmentName: contentContext.environmentName,
      };
    }

    if (contentContext?.sourceType === "release" && contentContext.releaseId) {
      return {
        releaseId: contentContext.releaseId,
      };
    }

    if (ctx.parsedDomain?.branch) {
      return {
        branch: ctx.parsedDomain.branch,
      };
    }

    if (ctx.environmentName) {
      return {
        environmentName: ctx.environmentName,
      };
    }

    if (ctx.releaseId) {
      return {
        releaseId: ctx.releaseId,
      };
    }

    return null;
  }

  private async tryResolveRemotePreparedCSS(
    ctx: HandlerContext,
    projectScope: string | undefined,
    styleProfileHash: string,
    contentContext: ResolvedContentContext | null,
    preparedContext?: PreparedProjectCSSRequestContext,
  ): Promise<{ css: string; hash: string } | undefined> {
    if (!projectScope) return undefined;

    const selector = this.resolveRemoteStyleArtifactSelector(contentContext, ctx);
    if (!selector) return undefined;

    const client = this.getVeryfrontApiClient(ctx);
    if (!client) return undefined;

    try {
      const resolved = await client.resolveStyleArtifact({
        ...selector,
        styleProfileHash,
      });

      if (resolved.status !== "ready" || !resolved.artifactHash) {
        if (resolved.status !== "building") {
          await this.ensureRemotePreparedCSSBuild(client, selector, styleProfileHash);
        }
        return undefined;
      }

      const css = await this.getPreparedCSSByHash(resolved.artifactHash, projectScope);
      if (!css) return undefined;

      if (preparedContext) {
        await storePreparedProjectCSS(preparedContext, {
          css,
          hash: resolved.artifactHash,
        });
      }

      return {
        css,
        hash: resolved.artifactHash,
      };
    } catch (error) {
      logger.debug("Failed to resolve prepared CSS via style artifact metadata", {
        projectScope,
        styleProfileHash,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async getPreparedCSSByHash(
    cssHash: string,
    projectScope: string,
  ): Promise<string | undefined> {
    const cached = await getCSSByHashAsync(cssHash);
    if (cached) return cached;
    return regenerateCSSByHash(cssHash, projectScope);
  }

  private async registerPreparedCSSArtifact(
    ctx: HandlerContext,
    styleProfileHash: string,
    contentContext: ResolvedContentContext | null,
    cssHash: string,
  ): Promise<void> {
    const selector = this.resolveRemoteStyleArtifactSelector(contentContext, ctx);
    if (!selector) return;

    const client = this.getVeryfrontApiClient(ctx);
    if (!client) return;

    try {
      await client.upsertStyleArtifact({
        ...selector,
        styleProfileHash,
        artifactHash: cssHash,
      });
    } catch (error) {
      logger.debug("Failed to register prepared CSS artifact", {
        cssHash,
        styleProfileHash,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private resolveRemoteStyleArtifactSelector(
    contentContext: ResolvedContentContext | null,
    ctx: HandlerContext,
  ): StyleArtifactSelectorContext | null {
    // Branch content changes in-place, but the remote style-artifact selector
    // has no content-version dimension. Treat any branch context as a terminal
    // remote-artifact opt-out so a stale branch artifact cannot be reused after
    // a push or registered for later consumers.
    if (contentContext?.sourceType === "branch" || ctx.parsedDomain?.branch) return null;

    return this.resolveStyleArtifactSelector(contentContext, ctx);
  }

  private shouldEnsureRemoteStyleArtifactBuild(selector: StyleArtifactSelectorContext): boolean {
    return Boolean(selector.environmentName || selector.releaseId);
  }

  private async ensureRemotePreparedCSSBuild(
    client: VeryfrontApiClient,
    selector: StyleArtifactSelectorContext,
    styleProfileHash: string,
  ): Promise<void> {
    if (!this.shouldEnsureRemoteStyleArtifactBuild(selector)) return;

    try {
      await client.ensureStyleArtifactBuild(
        {
          ...selector,
          styleProfileHash,
        } satisfies EnsureStyleArtifactBuildInput,
      );
    } catch (error) {
      logger.debug("Failed to ensure remote prepared CSS build", {
        selector,
        styleProfileHash,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
