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
  getCSSByHashAsync,
  getProjectCSS,
  regenerateCSSByHash,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { DEFAULT_STYLESHEET } from "#veryfront/html/styles-builder/css-hash-cache.ts";
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
import type {
  EnsureStyleArtifactBuildInput,
  ResolveStyleArtifactInput,
  VeryfrontApiClient,
} from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import { extractProjectCandidates } from "./styles-candidate-scanner.ts";

const logger = serverLogger.component("styles-css-handler");

type GeneratedStylesResult = Awaited<ReturnType<typeof getProjectCSS>>;
type StyleArtifactSelectorContext = Omit<ResolveStyleArtifactInput, "styleProfileHash">;

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
        let rawCss: string;
        try {
          rawCss = await this.loadStylesheet(ctx);
        } catch (error) {
          logger.error("Failed to load stylesheet", {
            error: error instanceof Error ? error.message : String(error),
          });
          rawCss = DEFAULT_STYLESHEET;
        }
        const preparedContext = this.createPreparedCSSContext(
          projectScope,
          rawCss,
          styleProfile.hash,
          contentContext,
          ctx,
        );

        if (preparedContext) {
          const prepared = await tryGetPreparedProjectCSS(preparedContext);
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

        const remotePrepared = await this.tryResolveRemotePreparedCSS(
          ctx,
          projectScope,
          styleProfile.hash,
          contentContext,
          preparedContext,
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

        let candidates: Set<string>;
        try {
          candidates = await extractProjectCandidates(ctx);
        } catch (error) {
          logger.error("Failed to extract candidates", {
            error: error instanceof Error ? error.message : String(error),
          });
          candidates = new Set<string>();
        }
        let result: GeneratedStylesResult;
        try {
          result = await this.generateStylesheet(ctx, rawCss, candidates);
        } catch (error) {
          const formatted = formatCSSError(error instanceof Error ? error : String(error));
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
          projectScope,
          candidates: candidates.size,
          cssLength: result.css.length,
          fromCache: "fromCache" in result ? result.fromCache : false,
          cssHash: "hash" in result ? result.hash : undefined,
        });

        if (preparedContext && "hash" in result) {
          await storePreparedProjectCSS(preparedContext, {
            css: result.css,
            hash: result.hash,
          });
        }

        if ("hash" in result) {
          await this.registerPreparedCSSArtifact(
            ctx,
            styleProfile.hash,
            contentContext,
            result.hash,
          );
        }

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
    } catch (_) {
      /* expected: globals.css may not exist */
      logger.debug("No stylesheet found, using default");
      return DEFAULT_STYLESHEET;
    }
  }

  private generateStylesheet(
    ctx: HandlerContext,
    rawCss: string,
    candidates: Set<string>,
  ): Promise<GeneratedStylesResult> {
    const projectScope = ctx.projectSlug ?? ctx.projectDir;

    return getProjectCSS(projectScope, rawCss, candidates, {
      minify: true,
      environment: "preview",
      buildMode: "production",
    });
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
    preparedContext?: PreparedProjectCSSRequestContext,
  ): Promise<{ css: string; hash: string } | undefined> {
    if (!projectScope) return undefined;

    const selector = this.resolveStyleArtifactSelector(contentContext, ctx);
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
    const selector = this.resolveStyleArtifactSelector(contentContext, ctx);
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
