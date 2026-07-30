/**
 * Styles CSS Handler
 *
 * Serves provider-generated CSS compiled from the project stylesheet and source candidates.
 * Extracts candidates from ALL source files to ensure HMR includes new classes.
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { joinPath } from "#veryfront/utils/path-utils.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import {
  acquireCSSGenerationSession,
  type CSSGenerationSession,
  formatCSSError,
  getCSSByHashAsync,
  getProjectCSS,
} from "#veryfront/html/styles-builder/css-compiler.ts";
import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import {
  createPreparedProjectCSSContext,
  type PreparedProjectCSSRequestContext,
  storePreparedProjectCSS,
  tryGetPreparedProjectCSS,
} from "#veryfront/html/styles-builder/prepared-project-css-cache.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { serverLogger } from "#veryfront/utils";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import {
  API_CLIENT_ERROR,
  assertStyleArtifactResolutionTuple,
  createStyleArtifactTuple,
  type EnsureStyleArtifactBuildInput,
  type ProjectStyleArtifactResolution,
  type StyleArtifactSelector,
  type StyleArtifactTuple,
  type VeryfrontApiClient,
} from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import { extractProjectCandidates } from "./styles-candidate-scanner.ts";
import { extractProjectCssImports } from "./styles-css-import-scanner.ts";
import { mergeImportedCSS } from "#veryfront/rendering/orchestrator/html-imported-css.ts";
import { profilePhase } from "#veryfront/observability";
import { COMPILATION_ERROR } from "#veryfront/errors";
import { isVeryfrontErrorInstance } from "#veryfront/errors/types.ts";

const logger = serverLogger.component("styles-css-handler");

type GeneratedStylesResult = Awaited<ReturnType<typeof getProjectCSS>>;
type StyleArtifactSelectorContext = StyleArtifactSelector;

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
        const projectScope = ctx.projectSlug ?? ctx.projectDir;
        const styleProfile = createStyleScopeProfile(ctx.config);
        const contentContext = this.getContentContext(ctx);
        const cssPipeline = await this.captureCSSPipeline();
        let rawCss = await profilePhase("css.load_stylesheet", () => this.loadStylesheet(ctx)) ??
          cssPipeline.compilationSession.defaultStylesheet;
        // Production SSR merges CSS imported by modules (`import "./styles.css"`
        // in a layout) into the page stylesheet during module loading. This
        // route has no module-loading pass, so discover those imports from the
        // project sources and merge them here. Runs before the prepared-CSS
        // context is created so cache keys reflect the merged stylesheet.
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
                globalCSS: rawCss,
                cssImports,
                stylesheetPath: ctx.config?.styles?.stylesheet ?? "globals.css",
              }),
          );
          if (merged) rawCss = merged;
        }
        const preparedContext = this.createPreparedCSSContext(
          projectScope,
          rawCss,
          styleProfile.hash,
          contentContext,
          ctx,
          cssPipeline.cacheIdentity,
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
              styleProfileHash: styleProfile.hash,
              cssHash: prepared.hash,
            });

            return this.respond(
              responseBuilder.withContentType("text/css; charset=utf-8", prepared.css, HTTP_OK),
            );
          }
        }

        const remotePrepared = await profilePhase(
          "css.remote_artifact_lookup",
          () =>
            this.tryResolveRemotePreparedCSS(
              ctx,
              projectScope,
              styleProfile.hash,
              contentContext,
              cssPipeline.cacheIdentity,
              preparedContext,
            ),
        );
        if (remotePrepared) {
          logger.debug("Prepared CSS resolved via style artifact metadata", {
            projectScope,
            styleProfileHash: styleProfile.hash,
            cssHash: remotePrepared.hash,
          });

          return this.respond(
            responseBuilder.withContentType("text/css; charset=utf-8", remotePrepared.css, HTTP_OK),
          );
        }

        const candidates = await profilePhase(
          "css.extract_candidates",
          () => extractProjectCandidates(ctx),
        );
        let result: GeneratedStylesResult;
        try {
          result = await profilePhase(
            "css.generate_stylesheet",
            () => this.generateStylesheet(ctx, rawCss, candidates, cssPipeline),
          );
        } catch (error) {
          const formatted = formatCSSError(error instanceof Error ? error : String(error));
          logger.error("CSS compilation error", {
            error: formatted.message,
            suggestion: formatted.suggestion,
          });

          throw COMPILATION_ERROR.create({
            detail: `${formatted.title}: ${formatted.message}. ${formatted.suggestion}`,
            cause: error,
          });
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
            styleProfile.hash,
            contentContext,
            result.hash,
            cssPipeline.cacheIdentity,
          );
        }

        return this.respond(
          responseBuilder.withContentType("text/css; charset=utf-8", result.css, HTTP_OK),
        );
      });
    } catch (error) {
      const failure = isVeryfrontErrorInstance(error) ? error : COMPILATION_ERROR.create({
        detail: "CSS generation failed",
        cause: error,
      });
      logger.error("CSS request failed", {
        error: failure.message,
        slug: failure.slug,
        status: failure.status,
        stack: failure.stack,
      });
      const responseBuilder = this.createResponseBuilder(ctx).withCache("no-cache");
      return this.respond(
        responseBuilder.withContentType(
          "application/problem+json; charset=utf-8",
          JSON.stringify(failure.toRFC9457()),
          failure.status,
        ),
      );
    }
  }

  private async loadStylesheet(ctx: HandlerContext): Promise<string | undefined> {
    const configuredPath = ctx.config?.styles?.stylesheet;

    if (configuredPath) {
      const filePath = joinPath(ctx.projectDir, configuredPath);
      return ctx.adapter.fs.readFile(filePath);
    }

    const globalsPath = joinPath(ctx.projectDir, "globals.css");
    try {
      return await ctx.adapter.fs.readFile(globalsPath);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      logger.debug("No stylesheet found, using processor default");
      return undefined;
    }
  }

  private generateStylesheet(
    ctx: HandlerContext,
    rawCss: string,
    candidates: Set<string>,
    cssPipeline: CSSGenerationSession,
  ): Promise<GeneratedStylesResult> {
    const projectScope = ctx.projectSlug ?? ctx.projectDir;

    return getProjectCSS(projectScope, rawCss, candidates, {
      minify: true,
      environment: "preview",
      buildMode: "production",
    }, {
      generationSession: cssPipeline,
    });
  }

  private captureCSSPipeline(): Promise<CSSGenerationSession> {
    return acquireCSSGenerationSession(true);
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
    projectScope: string | undefined,
    rawCss: string,
    styleProfileHash: string,
    contentContext: ResolvedContentContext | null,
    ctx: HandlerContext,
    cssPipelineIdentity: string,
  ) {
    if (!projectScope) return undefined;

    return createPreparedProjectCSSContext(
      projectScope,
      resolveStyleContentVersion(contentContext, {
        releaseId: ctx.releaseId,
        branch: ctx.parsedDomain?.branch,
        environmentName: ctx.environmentName,
      }),
      rawCss,
      styleProfileHash,
      {
        cssPipelineIdentity,
        minify: true,
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
    cssPipelineIdentity: string,
    preparedContext?: PreparedProjectCSSRequestContext,
  ): Promise<{ css: string; hash: string } | undefined> {
    if (!projectScope) {
      throw API_CLIENT_ERROR.create({
        detail: "Style artifact lookup requires a project scope",
        status: 502,
      });
    }
    if (this.isBranchRemoteArtifactOptOut(contentContext, ctx)) return undefined;

    const selector = this.resolveStyleArtifactSelector(contentContext, ctx);
    if (!selector) {
      throw API_CLIENT_ERROR.create({
        detail: "Style artifact lookup requires an exact source selector",
        status: 502,
      });
    }

    const client = this.getVeryfrontApiClient(ctx);
    if (!client) {
      throw API_CLIENT_ERROR.create({
        detail: "Style artifact lookup requires a Veryfront API client",
        status: 502,
      });
    }

    const tuple = createStyleArtifactTuple({
      ...selector,
      cssPipelineIdentity,
      styleProfileHash,
    });
    let resolved = await client.resolveStyleArtifact(tuple);
    assertStyleArtifactResolutionTuple(resolved, tuple);

    if (resolved.status === "missing") {
      resolved = await this.ensureRemotePreparedCSSBuild(client, tuple);
    }
    if (resolved.status === "missing" || resolved.status === "building") return undefined;
    if (resolved.status === "failed") {
      throw API_CLIENT_ERROR.create({
        detail: `Style artifact build failed: ${resolved.failureReason}`,
        status: 502,
      });
    }

    const css = await this.getPreparedCSSByHash(resolved.artifactHash);
    if (css === undefined) {
      throw API_CLIENT_ERROR.create({
        detail: `Ready style artifact ${resolved.artifactHash} was unavailable`,
        status: 502,
      });
    }

    if (preparedContext) {
      await storePreparedProjectCSS(preparedContext, {
        css,
        hash: resolved.artifactHash,
      });
    }

    return { css, hash: resolved.artifactHash };
  }

  private async getPreparedCSSByHash(
    cssHash: string,
  ): Promise<string | undefined> {
    return await getCSSByHashAsync(cssHash);
  }

  private async registerPreparedCSSArtifact(
    ctx: HandlerContext,
    styleProfileHash: string,
    contentContext: ResolvedContentContext | null,
    cssHash: string,
    cssPipelineIdentity: string,
  ): Promise<void> {
    if (this.isBranchRemoteArtifactOptOut(contentContext, ctx)) return;
    const selector = this.resolveStyleArtifactSelector(contentContext, ctx);
    if (!selector) {
      throw API_CLIENT_ERROR.create({
        detail: "Style artifact registration requires an exact source selector",
        status: 502,
      });
    }

    const client = this.getVeryfrontApiClient(ctx);
    if (!client) {
      throw API_CLIENT_ERROR.create({
        detail: "Style artifact registration requires a Veryfront API client",
        status: 502,
      });
    }
    const tuple = createStyleArtifactTuple({
      ...selector,
      cssPipelineIdentity,
      styleProfileHash,
    });
    const registered = await client.upsertStyleArtifact({ ...tuple, artifactHash: cssHash });
    assertStyleArtifactResolutionTuple(registered, tuple);
    if (registered.status !== "ready" || registered.artifactHash !== cssHash) {
      throw API_CLIENT_ERROR.create({
        detail: "Style artifact registration did not acknowledge the requested artifact",
        status: 502,
      });
    }
  }

  private isBranchRemoteArtifactOptOut(
    contentContext: ResolvedContentContext | null,
    ctx: HandlerContext,
  ): boolean {
    // Branch content changes in-place, but the remote style-artifact selector
    // has no content-version dimension. Treat any branch context as a terminal
    // remote-artifact opt-out so a stale branch artifact cannot be reused after
    // a push or registered for later consumers.
    return contentContext?.sourceType === "branch" || Boolean(ctx.parsedDomain?.branch);
  }

  private async ensureRemotePreparedCSSBuild(
    client: VeryfrontApiClient,
    tuple: StyleArtifactTuple,
  ): Promise<ProjectStyleArtifactResolution> {
    const resolution = await client.ensureStyleArtifactBuild(
      tuple satisfies EnsureStyleArtifactBuildInput,
    );
    assertStyleArtifactResolutionTuple(resolution, tuple);
    return resolution;
  }
}
