/**
 * Styles CSS request service
 *
 * Serves Tailwind CSS compiled from user's stylesheet + all project source files.
 * Extracts candidates from ALL source files to ensure HMR includes new classes.
 */

import type { HandlerContext } from "../types.ts";
import {
  getCSSByHashAsync,
  getProjectCSS,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { hashString } from "#veryfront/html/styles-builder/candidate-extractor.ts";
import {
  MAX_STYLE_SOURCE_PATH_BYTES,
  MAX_STYLESHEET_BYTES,
  utf8ByteLength,
} from "#veryfront/html/styles-builder/resource-limits.ts";
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
import { extractProjectCandidatesFromFiles } from "./styles-candidate-scanner.ts";
import { extractProjectCssImportsFromFiles } from "./styles-css-import-scanner.ts";
import { collectStyleSourceFiles } from "./styles-source-scanner.ts";
import { CSS_IMPORTING_SOURCE_EXTENSIONS } from "#veryfront/html/styles-builder/css-import-extraction.ts";
import { mergeImportedCSS } from "#veryfront/rendering/orchestrator/html-imported-css.ts";
import { profilePhase } from "#veryfront/observability";
import {
  COMPILATION_ERROR,
  CONFIG_INVALID,
  PERMISSION_DENIED,
  REQUEST_ERROR,
  SECURITY_VIOLATION,
  VeryfrontError,
} from "#veryfront/errors";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { validatePath, validatePathSync } from "#veryfront/security";
import { getSafeErrorName } from "../../utils/error-name.ts";

const logger = serverLogger.component("styles-css-handler");

type GeneratedStylesResult = Awaited<ReturnType<typeof getProjectCSS>>;
type StyleArtifactSelectorContext = Omit<ResolveStyleArtifactInput, "styleProfileHash">;

const PERMISSION_ERROR_CODES = new Set(["EACCES", "EPERM"]);
const PERMISSION_ERROR_NAMES = new Set(["NotCapable", "PermissionDenied"]);
const PROJECT_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function getBoundedErrorProperty(error: unknown, key: string): string | undefined {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return undefined;
  }
  try {
    const value = Reflect.get(error, key);
    return typeof value === "string" && value.length <= 64 ? value : undefined;
  } catch {
    return undefined;
  }
}

function isPermissionError(error: unknown, seen = new Set<unknown>()): boolean {
  if (seen.has(error)) return false;
  seen.add(error);
  if (error instanceof VeryfrontError && error.slug === "permission-denied") return true;

  const code = getBoundedErrorProperty(error, "code");
  if (code && PERMISSION_ERROR_CODES.has(code)) return true;
  const name = getBoundedErrorProperty(error, "name");
  if (name && PERMISSION_ERROR_NAMES.has(name)) return true;

  if ((typeof error !== "object" && typeof error !== "function") || error === null) return false;
  try {
    const cause = Reflect.get(error, "cause");
    return cause === undefined ? false : isPermissionError(cause, seen);
  } catch {
    return false;
  }
}

export function toPrivateStyleFailure(error: unknown): VeryfrontError {
  if (error instanceof VeryfrontError) {
    if (error.slug === "compilation-error") return COMPILATION_ERROR.create();
    if (error.slug === "config-invalid") return CONFIG_INVALID.create();
    if (error.slug === "permission-denied") return PERMISSION_DENIED.create();
    if (error.slug === "security-violation") return SECURITY_VIOLATION.create();
  }
  return REQUEST_ERROR.create();
}

export class StylesCSSService {
  async generate(ctx: HandlerContext): Promise<string> {
    const projectScope = this.resolveProjectScope(ctx);
    const styleProfile = createStyleScopeProfile(ctx.config);
    const contentContext = this.getContentContext(ctx);
    let rawCss = await profilePhase("css.load_stylesheet", () => this.loadStylesheet(ctx));

    // Candidate extraction and CSS import discovery must observe the same
    // source snapshot. Apart from avoiding duplicate I/O, this prevents a file
    // change between scans from producing a stylesheet with mismatched inputs.
    const sourceFiles = await this.runCompilationPhase(
      "css.scan_sources",
      () =>
        collectStyleSourceFiles(ctx, {
          extensions: CSS_IMPORTING_SOURCE_EXTENSIONS,
        }),
    );
    const cssImports = await this.runCompilationPhase(
      "css.scan_css_imports",
      () => extractProjectCssImportsFromFiles(ctx, sourceFiles),
    );
    if (cssImports.length > 0) {
      const merged = await this.runCompilationPhase(
        "css.merge_imported_css",
        () =>
          mergeImportedCSS({
            fs: this.createBoundedImportedStylesheetFileSystem(ctx, rawCss),
            logger,
            projectDir: ctx.projectDir,
            globalCSS: rawCss,
            cssImports,
            stylesheetPath: ctx.config?.tailwind?.stylesheet ?? "globals.css",
          }),
      );
      if (merged !== undefined) rawCss = merged;
    }

    if (rawCss === "") return "";

    const preparedContext = this.createPreparedCSSContext(
      projectScope,
      rawCss,
      styleProfile.hash,
      contentContext,
      ctx,
    );
    const prepared = await profilePhase(
      "css.prepared_cache_lookup",
      () => tryGetPreparedProjectCSS(preparedContext),
    );
    if (prepared) return prepared.css;

    const remotePrepared = await profilePhase(
      "css.remote_artifact_lookup",
      () =>
        this.tryResolveRemotePreparedCSS(
          ctx,
          styleProfile.hash,
          contentContext,
          preparedContext,
        ),
    );
    if (remotePrepared) return remotePrepared.css;

    const candidates = await this.runCompilationPhase(
      "css.extract_candidates",
      () => Promise.resolve(extractProjectCandidatesFromFiles(ctx, sourceFiles)),
    );
    const result = await this.runCompilationPhase(
      "css.generate_stylesheet",
      () => this.generateStylesheet(projectScope, rawCss, candidates),
    );

    await profilePhase(
      "css.store_prepared",
      () =>
        storePreparedProjectCSS(preparedContext, {
          css: result.css,
          hash: result.hash,
        }),
    );
    await this.registerPreparedCSSArtifact(
      ctx,
      styleProfile.hash,
      contentContext,
      result.hash,
    );
    return result.css;
  }

  private async loadStylesheet(ctx: HandlerContext): Promise<string> {
    const configuredPath = ctx.config?.tailwind?.stylesheet;
    const stylesheetPath = configuredPath?.replace(/^\/+/, "") ?? "globals.css";
    if (
      !stylesheetPath || stylesheetPath.length > MAX_STYLE_SOURCE_PATH_BYTES ||
      utf8ByteLength(stylesheetPath) > MAX_STYLE_SOURCE_PATH_BYTES
    ) {
      throw CONFIG_INVALID.create();
    }

    const lexicalResult = validatePathSync(stylesheetPath, {
      baseDir: ctx.projectDir,
      allowAbsolute: false,
      level: "strict",
    });
    if (!lexicalResult.valid) throw CONFIG_INVALID.create();

    let canonicalPath: string;
    try {
      const physicalResult = await validatePath(stylesheetPath, {
        baseDir: ctx.projectDir,
        allowAbsolute: false,
        level: "normal",
        adapter: ctx.adapter,
        followSymlinks: true,
      });
      if (!physicalResult.valid || !physicalResult.canonicalPath) {
        throw configuredPath ? CONFIG_INVALID.create() : SECURITY_VIOLATION.create();
      }
      if (
        physicalResult.canonicalPath.length > MAX_STYLE_SOURCE_PATH_BYTES ||
        utf8ByteLength(physicalResult.canonicalPath) > MAX_STYLE_SOURCE_PATH_BYTES
      ) {
        throw configuredPath ? CONFIG_INVALID.create() : SECURITY_VIOLATION.create();
      }
      canonicalPath = physicalResult.canonicalPath;
    } catch (error) {
      throw this.classifyStylesheetReadFailure(error, Boolean(configuredPath));
    }

    let fileInfo: Awaited<ReturnType<HandlerContext["adapter"]["fs"]["stat"]>>;
    try {
      fileInfo = await ctx.adapter.fs.stat(canonicalPath);
    } catch (error) {
      if (isNotFoundError(error) && !configuredPath) return "";
      throw this.classifyStylesheetReadFailure(error, Boolean(configuredPath));
    }
    if (
      !fileInfo.isFile || !Number.isSafeInteger(fileInfo.size) || fileInfo.size < 0 ||
      fileInfo.size > MAX_STYLESHEET_BYTES
    ) {
      throw CONFIG_INVALID.create();
    }

    try {
      const stylesheet = await ctx.adapter.fs.readFile(canonicalPath);
      if (
        stylesheet.length > MAX_STYLESHEET_BYTES ||
        utf8ByteLength(stylesheet) > MAX_STYLESHEET_BYTES
      ) {
        throw CONFIG_INVALID.create();
      }
      return stylesheet;
    } catch (error) {
      if (isNotFoundError(error) && !configuredPath) return "";
      throw this.classifyStylesheetReadFailure(error, Boolean(configuredPath));
    }
  }

  private generateStylesheet(
    projectScope: string,
    rawCss: string,
    candidates: Set<string>,
  ): Promise<GeneratedStylesResult> {
    return getProjectCSS(projectScope, rawCss, candidates, {
      minify: true,
      environment: "preview",
      buildMode: "production",
    });
  }

  private resolveProjectScope(ctx: HandlerContext): string {
    if (
      !ctx.projectDir || ctx.projectDir.length > MAX_STYLE_SOURCE_PATH_BYTES ||
      utf8ByteLength(ctx.projectDir) > MAX_STYLE_SOURCE_PATH_BYTES
    ) {
      throw CONFIG_INVALID.create();
    }
    if (ctx.projectSlug) {
      if (!PROJECT_SCOPE_PATTERN.test(ctx.projectSlug)) throw CONFIG_INVALID.create();
      return ctx.projectSlug;
    }
    return `local-${hashString(ctx.projectDir)}`;
  }

  private classifyStylesheetReadFailure(
    error: unknown,
    configured: boolean,
  ): VeryfrontError {
    if (error instanceof VeryfrontError) {
      if (error.slug === "config-invalid") return CONFIG_INVALID.create();
      if (error.slug === "security-violation") return SECURITY_VIOLATION.create();
    }
    if (isPermissionError(error)) return PERMISSION_DENIED.create();
    if (isNotFoundError(error) && configured) return CONFIG_INVALID.create();
    return REQUEST_ERROR.create();
  }

  private async runCompilationPhase<T>(name: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await profilePhase(name, fn);
    } catch (error) {
      if (isPermissionError(error)) throw PERMISSION_DENIED.create();
      if (error instanceof VeryfrontError) {
        if (error.slug === "config-invalid") throw CONFIG_INVALID.create();
        if (error.slug === "security-violation") throw SECURITY_VIOLATION.create();
      }
      throw COMPILATION_ERROR.create();
    }
  }

  private createBoundedImportedStylesheetFileSystem(
    ctx: HandlerContext,
    globalCss: string,
  ): { readFile(path: string): Promise<string> } {
    let totalBytes = utf8ByteLength(globalCss);

    return {
      readFile: async (path: string): Promise<string> => {
        const remainingBytes = MAX_STYLESHEET_BYTES - totalBytes;
        const fileInfo = await ctx.adapter.fs.stat(path);
        if (
          !fileInfo.isFile || !Number.isSafeInteger(fileInfo.size) || fileInfo.size < 0 ||
          fileInfo.size > remainingBytes
        ) {
          throw COMPILATION_ERROR.create();
        }

        const content = await ctx.adapter.fs.readFile(path);
        if (content.length > remainingBytes) throw COMPILATION_ERROR.create();
        const contentBytes = utf8ByteLength(content);
        if (contentBytes > remainingBytes) throw COMPILATION_ERROR.create();
        totalBytes += contentBytes;
        return content;
      },
    };
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
    projectScope: string,
    rawCss: string,
    styleProfileHash: string,
    contentContext: ResolvedContentContext | null,
    ctx: HandlerContext,
  ) {
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
    styleProfileHash: string,
    contentContext: ResolvedContentContext | null,
    preparedContext?: PreparedProjectCSSRequestContext,
  ): Promise<{ css: string; hash: string } | undefined> {
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

      const css = await this.getPreparedCSSByHash(resolved.artifactHash);
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
        errorName: getSafeErrorName(error),
      });
      return undefined;
    }
  }

  private async getPreparedCSSByHash(cssHash: string): Promise<string | undefined> {
    return await getCSSByHashAsync(cssHash);
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
        errorName: getSafeErrorName(error),
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
        errorName: getSafeErrorName(error),
      });
    }
  }
}
