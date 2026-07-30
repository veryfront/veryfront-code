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
import { assertCSSContentIdentity } from "#veryfront/html/styles-builder/css-identity.ts";
import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import {
  createPreparedProjectCSSContext,
  type PreparedProjectCSSRequestContext,
  storePreparedProjectCSS,
  tryGetPreparedProjectCSS,
} from "#veryfront/html/styles-builder/prepared-project-css-cache.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { serverLogger } from "#veryfront/utils";
import type {
  ResolvedContentContext,
  StyleArtifactAccess,
  StyleArtifactRegistry,
} from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import {
  API_CLIENT_ERROR,
  assertStyleArtifactResolutionTuple,
  createStyleArtifactTuple,
  type EnsureStyleArtifactBuildInput,
  type ProjectStyleArtifactResolution,
  type ResolveStyleArtifactInput,
  type StyleArtifactSelector,
  type StyleArtifactTuple,
  type UpsertStyleArtifactInput,
} from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import { extractProjectCandidates } from "./styles-candidate-scanner.ts";
import { extractProjectCssImports } from "./styles-css-import-scanner.ts";
import { mergeImportedCSS } from "#veryfront/rendering/orchestrator/html-imported-css.ts";
import { profilePhase } from "#veryfront/observability";
import { COMPILATION_ERROR } from "#veryfront/errors";
import { isVeryfrontErrorInstance } from "#veryfront/errors/types.ts";

const logger = serverLogger.component("styles-css-handler");

type GeneratedStylesResult = Awaited<ReturnType<typeof getProjectCSS>>;
type StyleArtifactPlan =
  | Readonly<{ kind: "local"; contentContext: null }>
  | Readonly<{
    kind: "branch";
    branch: string;
    contentContext: Readonly<ResolvedContentContext> | null;
  }>
  | Readonly<{
    kind: "remote";
    contentContext: Readonly<ResolvedContentContext>;
    tuple: StyleArtifactTuple;
    registry: Readonly<StyleArtifactRegistry>;
  }>;

const LOCAL_STYLE_ARTIFACT_PLAN = Object.freeze(
  {
    kind: "local",
    contentContext: null,
  } as const satisfies StyleArtifactPlan,
);

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
        const cssPipeline = await this.captureCSSPipeline();
        const artifactPlan = await this.resolveStyleArtifactPlan(
          ctx,
          styleProfile.hash,
          cssPipeline.cacheIdentity,
        );
        const projectVersion = this.resolveStyleProjectVersion(artifactPlan, ctx);
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
          projectVersion,
          rawCss,
          styleProfile.hash,
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
              artifactPlan,
              projectScope,
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
          () =>
            extractProjectCandidates(ctx, {
              projectVersion,
              developmentMode: artifactPlan.kind === "branch",
            }),
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

        if ("hash" in result) {
          // Validate the generated identity before making either side effect.
          // Hosted artifacts must be registered successfully before the local
          // prepared cache is published, otherwise a failed registration could
          // fail open as a cache hit on the next request.
          assertCSSContentIdentity(result.css, result.hash);
          await this.registerPreparedCSSArtifact(
            artifactPlan,
            result.hash,
          );

          if (preparedContext) {
            await profilePhase(
              "css.store_prepared",
              () =>
                storePreparedProjectCSS(preparedContext, {
                  css: result.css,
                  hash: result.hash,
                }),
            );
          }
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

  private createPreparedCSSContext(
    projectScope: string | undefined,
    projectVersion: string,
    rawCss: string,
    styleProfileHash: string,
    cssPipelineIdentity: string,
  ) {
    if (!projectScope) return undefined;

    return createPreparedProjectCSSContext(
      projectScope,
      projectVersion,
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

  private async resolveStyleArtifactPlan(
    ctx: HandlerContext,
    styleProfileHash: string,
    cssPipelineIdentity: string,
  ): Promise<StyleArtifactPlan> {
    // Request branches are mutable while the remote artifact tuple has no
    // source-revision dimension. This is a terminal opt-out: do not consult a
    // published adapter capability, and key any local prepared entry by the
    // request branch fallback instead of a conflicting published context.
    if (ctx.parsedDomain?.branch) {
      const tuple = this.createValidatedStyleArtifactTuple(
        { branch: ctx.parsedDomain.branch },
        styleProfileHash,
        cssPipelineIdentity,
        "Branch CSS request requires an exact branch selector",
      );
      if (tuple.branch === undefined) {
        throw API_CLIENT_ERROR.create({
          detail: "Branch CSS request requires an exact branch selector",
          status: 502,
        });
      }
      return Object.freeze({ kind: "branch", branch: tuple.branch, contentContext: null });
    }

    const fs = ctx.adapter.fs as typeof ctx.adapter.fs & {
      getStyleArtifactAccess?: () => Promise<StyleArtifactAccess>;
    };
    const getAccess = fs.getStyleArtifactAccess;
    if (typeof getAccess !== "function") {
      if (isExtendedFSAdapter(ctx.adapter.fs) && ctx.adapter.fs.isVeryfrontAdapter()) {
        throw API_CLIENT_ERROR.create({
          detail: "Veryfront filesystem requires request-scoped style artifact access",
          status: 502,
        });
      }
      return LOCAL_STYLE_ARTIFACT_PLAN;
    }

    const access = this.captureStyleArtifactAccess(await getAccess.call(fs));
    if (!access) {
      throw API_CLIENT_ERROR.create({
        detail: "Veryfront filesystem returned invalid style artifact access",
        status: 502,
      });
    }

    const contentContext = access.contentContext;
    if (!ctx.projectSlug || contentContext.projectSlug !== ctx.projectSlug) {
      throw API_CLIENT_ERROR.create({
        detail: "Style artifact access did not match the request project",
        status: 502,
      });
    }

    // Resolved branch content is also mutable and therefore cannot safely use
    // remote artifact metadata without a source-revision tuple dimension.
    if (contentContext.sourceType === "branch") {
      if (typeof contentContext.branch !== "string") {
        throw API_CLIENT_ERROR.create({
          detail: "Branch style artifact access requires an exact branch selector",
          status: 502,
        });
      }
      const tuple = this.createValidatedStyleArtifactTuple(
        { branch: contentContext.branch },
        styleProfileHash,
        cssPipelineIdentity,
        "Branch style artifact access requires an exact branch selector",
      );
      if (tuple.branch === undefined) {
        throw API_CLIENT_ERROR.create({
          detail: "Branch style artifact access requires an exact branch selector",
          status: 502,
        });
      }
      return Object.freeze({ kind: "branch", branch: tuple.branch, contentContext });
    }

    let selector: StyleArtifactSelector;
    if (contentContext.sourceType === "environment" && contentContext.environmentName) {
      selector = { environmentName: contentContext.environmentName };
    } else if (contentContext.sourceType === "release" && contentContext.releaseId) {
      selector = { releaseId: contentContext.releaseId };
    } else {
      throw API_CLIENT_ERROR.create({
        detail: "Style artifact access requires an exact source selector",
        status: 502,
      });
    }
    const tuple = this.createValidatedStyleArtifactTuple(
      selector,
      styleProfileHash,
      cssPipelineIdentity,
      "Style artifact access requires an exact source selector",
    );

    return Object.freeze({
      kind: "remote",
      contentContext,
      tuple,
      registry: access.registry,
    });
  }

  private createValidatedStyleArtifactTuple(
    selector: StyleArtifactSelector,
    styleProfileHash: string,
    cssPipelineIdentity: string,
    detail: string,
  ): StyleArtifactTuple {
    try {
      return createStyleArtifactTuple({
        ...selector,
        cssPipelineIdentity,
        styleProfileHash,
      });
    } catch (cause) {
      throw API_CLIENT_ERROR.create({ detail, status: 502, cause });
    }
  }

  private resolveStyleProjectVersion(
    artifactPlan: StyleArtifactPlan,
    ctx: HandlerContext,
  ): string {
    if (artifactPlan.kind === "branch") {
      return resolveStyleContentVersion(artifactPlan.contentContext, {
        branch: artifactPlan.branch,
      });
    }
    if (artifactPlan.kind === "remote") {
      return resolveStyleContentVersion(artifactPlan.contentContext);
    }
    return resolveStyleContentVersion(null, {
      releaseId: ctx.releaseId,
      branch: ctx.parsedDomain?.branch,
      environmentName: ctx.environmentName,
    });
  }

  private captureStyleArtifactAccess(access: unknown): StyleArtifactAccess | null {
    if (typeof access !== "object" || access === null || Array.isArray(access)) return null;
    const contentContextValue = this.readOwnDataProperty(access, "contentContext");
    const registryValue = this.readOwnDataProperty(access, "registry");
    if (
      !contentContextValue.ok || !registryValue.ok ||
      typeof contentContextValue.value !== "object" || contentContextValue.value === null ||
      Array.isArray(contentContextValue.value) ||
      typeof registryValue.value !== "object" || registryValue.value === null ||
      Array.isArray(registryValue.value)
    ) {
      return null;
    }

    const rawContext = contentContextValue.value;
    const projectSlug = this.readOwnDataProperty(rawContext, "projectSlug");
    const sourceType = this.readOwnDataProperty(rawContext, "sourceType");
    if (
      !projectSlug.ok || typeof projectSlug.value !== "string" ||
      !sourceType.ok ||
      (sourceType.value !== "branch" &&
        sourceType.value !== "environment" &&
        sourceType.value !== "release")
    ) {
      return null;
    }

    const contextSnapshot: ResolvedContentContext = {
      projectSlug: projectSlug.value,
      sourceType: sourceType.value,
    };
    const selectorKeys = sourceType.value === "branch"
      ? ["branch"] as const
      : sourceType.value === "environment"
      ? ["environmentName", "releaseId"] as const
      : ["releaseId"] as const;
    for (const key of selectorKeys) {
      const selector = this.readOwnDataProperty(rawContext, key, false);
      if (!selector.ok) return null;
      if (selector.value === undefined) continue;
      if (typeof selector.value !== "string") return null;
      contextSnapshot[key] = selector.value;
    }

    const rawRegistry = registryValue.value;
    const resolve = this.readOwnDataProperty(rawRegistry, "resolveStyleArtifact");
    const ensure = this.readOwnDataProperty(rawRegistry, "ensureStyleArtifactBuild");
    const upsert = this.readOwnDataProperty(rawRegistry, "upsertStyleArtifact");
    if (
      !resolve.ok || typeof resolve.value !== "function" ||
      !ensure.ok || typeof ensure.value !== "function" ||
      !upsert.ok || typeof upsert.value !== "function"
    ) {
      return null;
    }
    const resolveOperation = resolve.value as StyleArtifactRegistry["resolveStyleArtifact"];
    const ensureOperation = ensure.value as StyleArtifactRegistry["ensureStyleArtifactBuild"];
    const upsertOperation = upsert.value as StyleArtifactRegistry["upsertStyleArtifact"];

    const registry: Readonly<StyleArtifactRegistry> = Object.freeze({
      resolveStyleArtifact: (input: ResolveStyleArtifactInput) =>
        Reflect.apply(resolveOperation, rawRegistry, [input]) as Promise<
          ProjectStyleArtifactResolution
        >,
      ensureStyleArtifactBuild: (input: EnsureStyleArtifactBuildInput) =>
        Reflect.apply(ensureOperation, rawRegistry, [input]) as Promise<
          ProjectStyleArtifactResolution
        >,
      upsertStyleArtifact: (input: UpsertStyleArtifactInput) =>
        Reflect.apply(upsertOperation, rawRegistry, [input]) as Promise<
          ProjectStyleArtifactResolution
        >,
    });
    return Object.freeze({
      contentContext: Object.freeze(contextSnapshot),
      registry,
    });
  }

  private readOwnDataProperty(
    value: object,
    key: PropertyKey,
    required = true,
  ): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }> {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_) {
      return { ok: false };
    }
    if (!descriptor) return required ? { ok: false } : { ok: true, value: undefined };
    return "value" in descriptor ? { ok: true, value: descriptor.value } : { ok: false };
  }

  private async tryResolveRemotePreparedCSS(
    artifactPlan: StyleArtifactPlan,
    projectScope: string | undefined,
    preparedContext?: PreparedProjectCSSRequestContext,
  ): Promise<{ css: string; hash: string } | undefined> {
    if (artifactPlan.kind !== "remote") return undefined;
    if (!projectScope) {
      throw API_CLIENT_ERROR.create({
        detail: "Style artifact lookup requires a project scope",
        status: 502,
      });
    }
    const tuple = artifactPlan.tuple;
    let resolved = await artifactPlan.registry.resolveStyleArtifact(tuple);
    assertStyleArtifactResolutionTuple(resolved, tuple);

    if (resolved.status === "missing") {
      resolved = await this.ensureRemotePreparedCSSBuild(artifactPlan.registry, tuple);
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
    artifactPlan: StyleArtifactPlan,
    cssHash: string,
  ): Promise<void> {
    if (artifactPlan.kind !== "remote") return;
    const tuple = artifactPlan.tuple;
    const registered = await artifactPlan.registry.upsertStyleArtifact({
      ...tuple,
      artifactHash: cssHash,
    });
    assertStyleArtifactResolutionTuple(registered, tuple);
    if (registered.status !== "ready" || registered.artifactHash !== cssHash) {
      throw API_CLIENT_ERROR.create({
        detail: "Style artifact registration did not acknowledge the requested artifact",
        status: 502,
      });
    }
  }

  private async ensureRemotePreparedCSSBuild(
    registry: Readonly<StyleArtifactRegistry>,
    tuple: StyleArtifactTuple,
  ): Promise<ProjectStyleArtifactResolution> {
    const resolution = await registry.ensureStyleArtifactBuild(
      tuple satisfies EnsureStyleArtifactBuildInput,
    );
    assertStyleArtifactResolutionTuple(resolution, tuple);
    return resolution;
  }
}
