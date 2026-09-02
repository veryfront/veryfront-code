import { rendererLogger as logger } from "#veryfront/utils";
import { ensureError, getErrorMessage, RENDER_ERROR } from "#veryfront/errors";
import type * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo, MdxBundle, MDXComponents, MDXModule, PageBundle } from "#veryfront/types";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { clearMdxEsmCacheNamespace } from "#veryfront/transforms/mdx/esm-module-loader/index.ts";
import { getProjectReact } from "#veryfront/react";
import { flattenRouteParams } from "#veryfront/routing";
import { compileContent } from "#veryfront/transforms/mdx/compiler/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";

interface MDXPageResult {
  pageElement: BundledReact.ReactElement;
  pageBundle: PageBundle;
  collectedMetadata: Record<string, unknown>;
}

interface PreparedMDXPageBundles {
  pageBundle: PageBundle;
  serverModuleCode: string;
}

interface StaleMdxEsmRecoveryOptions {
  adapter: RuntimeAdapter;
  projectId?: string;
  projectSlug?: string;
  contentSourceId?: string;
  slug: string;
  pagePath: string;
  /** Render mode of the failing request ("development" | "production"). */
  mode?: string;
}

/**
 * A recovered namespace stays on cooldown for this long. Recovery deletes the
 * project's whole MDX ESM cache namespace and forces a source-snapshot
 * refresh, so a route whose error survives the retry must not be able to pay
 * that cost again on the very next request.
 */
const STALE_MDX_ESM_RECOVERY_COOLDOWN_MS = 30_000;
/** Ceiling on remembered namespaces, so the cooldown map cannot grow without bound. */
const STALE_MDX_ESM_RECOVERY_MAX_TRACKED_NAMESPACES = 512;

/** Namespace key -> epoch ms at which its last recovery started. */
const staleMdxEsmRecoveryAttempts = new Map<string, number>();
/** Namespace key -> in-flight recovery, so concurrent renders share one pass. */
const staleMdxEsmRecoveryInFlight = new Map<string, Promise<boolean>>();

// HEURISTIC: detect stale-cache ESM export mismatches by matching runtime
// error messages. Both the "does not provide an export named" phrasing and the
// "requested module / import" context check are taken from V8/Deno's wording.
// If the runtime changes its error message, this detection stops firing and
// the stale-cache recovery path becomes a dead code path — verify after
// runtime upgrades.
export function isMdxEsmExportMismatchError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /does not provide an export named/i.test(message) &&
    /requested module|import/i.test(message);
}

/**
 * Stale-cache recovery is a PREVIEW affordance: only a mutable content source
 * — a local checkout or a branch preview — can drift out of step with the ESM
 * modules compiled and cached for it. An immutable release source that raises
 * the same error is serving a genuinely broken build, and the message match is
 * a heuristic that user code (including generateMetadata) can produce, so
 * recovering there would let every unauthenticated public request evict the
 * project's entire MDX ESM cache namespace and force a backend source-snapshot
 * refresh plus a full module rebuild. Classification mirrors
 * `computeContentSourceId`, the single source of truth for these ids, and
 * fails closed for an id it does not recognize.
 */
export function isMutableMdxEsmContentSource(
  contentSourceId: string | undefined,
  mode?: string,
): boolean {
  // A development-mode render is the local dev server, whose sources are
  // mutable files on disk even when no content source id is threaded through.
  if (mode === "development") return true;
  if (!contentSourceId) return false;

  return contentSourceId === "preview" ||
    contentSourceId === "preview-draft" ||
    contentSourceId.startsWith("preview-") ||
    contentSourceId.startsWith("local-");
}

function getStaleMdxEsmRecoveryKey(options: StaleMdxEsmRecoveryOptions): string {
  const namespace = options.projectId ?? options.projectSlug ?? "";
  return `${namespace}::${options.contentSourceId ?? ""}`;
}

function pruneStaleMdxEsmRecoveryAttempts(now: number): void {
  for (const [key, attemptedAt] of staleMdxEsmRecoveryAttempts) {
    if (now - attemptedAt >= STALE_MDX_ESM_RECOVERY_COOLDOWN_MS) {
      staleMdxEsmRecoveryAttempts.delete(key);
    }
  }

  // Map iteration is insertion ordered, so the first key is the oldest entry.
  while (staleMdxEsmRecoveryAttempts.size > STALE_MDX_ESM_RECOVERY_MAX_TRACKED_NAMESPACES) {
    const oldest = staleMdxEsmRecoveryAttempts.keys().next();
    if (oldest.done) break;
    staleMdxEsmRecoveryAttempts.delete(oldest.value);
  }
}

async function performStaleMdxEsmRecovery(
  options: StaleMdxEsmRecoveryOptions,
): Promise<boolean> {
  let recovered = false;
  const refreshSourceSnapshot = options.adapter.fs.refreshSourceSnapshot;

  if (typeof refreshSourceSnapshot === "function") {
    await refreshSourceSnapshot.call(options.adapter.fs, "mdx-esm-export-mismatch");
    recovered = true;
  }

  if (options.projectId && options.contentSourceId) {
    await clearMdxEsmCacheNamespace(options.projectId, options.contentSourceId);
    recovered = true;
  }

  if (recovered) {
    logger.warn("Recovered stale MDX ESM preview caches, retrying render", {
      slug: options.slug,
      pagePath: options.pagePath,
      projectId: options.projectId,
      projectSlug: options.projectSlug,
      contentSourceId: options.contentSourceId,
    });
  }

  return recovered;
}

export async function recoverStaleMdxEsmPreviewCaches(
  options: StaleMdxEsmRecoveryOptions,
): Promise<boolean> {
  if (!isMutableMdxEsmContentSource(options.contentSourceId, options.mode)) {
    logger.debug("Skipping stale MDX ESM cache recovery for an immutable content source", {
      slug: options.slug,
      pagePath: options.pagePath,
      projectId: options.projectId,
      projectSlug: options.projectSlug,
      contentSourceId: options.contentSourceId,
    });
    return false;
  }

  const key = getStaleMdxEsmRecoveryKey(options);
  const inFlight = staleMdxEsmRecoveryInFlight.get(key);
  if (inFlight) return await inFlight;

  const now = Date.now();
  const attemptedAt = staleMdxEsmRecoveryAttempts.get(key);
  // A negative delta means the wall clock stepped backwards; treat it as
  // "still cooling down" rather than handing out an unbounded retry budget.
  if (attemptedAt !== undefined && now - attemptedAt < STALE_MDX_ESM_RECOVERY_COOLDOWN_MS) {
    logger.debug("Skipping stale MDX ESM cache recovery still within its cooldown", {
      slug: options.slug,
      pagePath: options.pagePath,
      projectId: options.projectId,
      projectSlug: options.projectSlug,
      contentSourceId: options.contentSourceId,
    });
    return false;
  }

  staleMdxEsmRecoveryAttempts.set(key, now);
  pruneStaleMdxEsmRecoveryAttempts(now);

  const recovery = performStaleMdxEsmRecovery(options);
  staleMdxEsmRecoveryInFlight.set(key, recovery);

  try {
    return await recovery;
  } finally {
    if (staleMdxEsmRecoveryInFlight.get(key) === recovery) {
      staleMdxEsmRecoveryInFlight.delete(key);
    }
  }
}

/** Test-only: drop the recovery cooldown so cases do not leak into each other. */
export function __resetStaleMdxEsmRecoveryStateForTests(): void {
  staleMdxEsmRecoveryAttempts.clear();
  staleMdxEsmRecoveryInFlight.clear();
}

export async function prepareMDXPageBundles(
  pageInfo: EntityInfo,
  projectDir: string,
  options?: {
    precompiledModule?: string;
    studioEmbed?: boolean;
  },
): Promise<PreparedMDXPageBundles> {
  const { frontmatter, content, path } = pageInfo.entity;
  const fmArg = frontmatter && Object.keys(frontmatter).length > 0 ? frontmatter : undefined;

  const ssrBundle = await compileContent(
    "development",
    projectDir,
    content,
    fmArg,
    path,
    "server",
    undefined,
    options?.studioEmbed,
  );

  const pageBundle = ssrBundle as PageBundle;

  if (options?.precompiledModule) {
    pageBundle.clientModuleCode = options.precompiledModule;
  } else {
    const browserBundle = await compileContent(
      "development",
      projectDir,
      content,
      fmArg,
      path,
      "browser",
      undefined,
      options?.studioEmbed,
    );
    pageBundle.clientModuleCode = browserBundle.compiledCode;
  }

  const clientModuleCode = pageBundle.clientModuleCode;
  if (!clientModuleCode) {
    throw RENDER_ERROR.create({
      detail: "MDX compilation produced no client module code",
    });
  }

  return {
    pageBundle,
    serverModuleCode: ssrBundle.compiledCode,
  };
}

export function handleMDXPage(
  pageInfo: EntityInfo,
  slug: string,
  projectDir: string,
  mergedComponents: MDXComponents,
  _compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>,
  adapter: RuntimeAdapter,
  options?: {
    params?: Record<string, string | string[]>;
    url?: URL;
    precompiledModule?: string;
    /** Project ID for cache isolation */
    projectId?: string;
    /** Project slug for HTTP fallback in multi-project mode */
    projectSlug?: string;
    /** Enable node position injection for Studio Navigator */
    studioEmbed?: boolean;
    /** Content source identifier for cache isolation (branch name or release ID) */
    contentSourceId?: string;
    /** React version resolved for this project. */
    reactVersion?: string;
    /** Request-scoped dependency-pinning state used by transform caches. */
    dependencyPinningCacheKey?: string;
    /** Immutable package map paired with dependencyPinningCacheKey. */
    dependencyPinningDependencies?: Readonly<Record<string, string>>;
    /** Exact package source namespace paired with the immutable snapshot. */
    dependencyPinningSource?: DependencyPinningSourceInput;
    /** Bare npm package roots that the runtime resolves without bundling. */
    serverExternalPackages?: readonly string[];
    /** Server-trusted local-project identity for dev-only module-server fallback. */
    isLocalProject?: boolean;
    /** Request mode ("development" | "production") for the module compile mode */
    mode?: string;
  },
): Promise<MDXPageResult> {
  return withSpan(
    "rendering.handleMDXPage",
    async () => {
      const { frontmatter, path } = pageInfo.entity;
      const { pageBundle, serverModuleCode } = await prepareMDXPageBundles(pageInfo, projectDir, {
        precompiledModule: options?.precompiledModule,
        studioEmbed: options?.studioEmbed,
      });

      const loadPageElement = async (): Promise<MDXPageResult> => {
        let collectedMetadata: Record<string, unknown> = {};

        const mod = (await mdxRenderer.loadModuleESM(serverModuleCode, {
          adapter,
          projectId: options?.projectId,
          projectDir,
          projectSlug: options?.projectSlug,
          contentSourceId: options?.contentSourceId,
          // A missing render mode compiles for production, matching the SSR
          // module loader and #3844's production-leaning default.
          mode: options?.mode === "development" ? "development" : "production",
          reactVersion: options?.reactVersion,
          serverExternalPackages: options?.serverExternalPackages,
          dependencyPinningCacheKey: options?.dependencyPinningCacheKey,
          dependencyPinningDependencies: options?.dependencyPinningDependencies,
          dependencyPinningSource: options?.dependencyPinningSource,
          moduleServerOrigin: options?.url?.origin,
          isLocalProject: options?.isLocalProject,
        })) as MDXModule;

        const MDXComp = mod.MDXContent || mod.default;
        if (!MDXComp) {
          throw RENDER_ERROR.create({
            detail: "Compiled MDX module has no content export",
          });
        }

        if (mod.metadata && typeof mod.metadata === "object") {
          collectedMetadata = { ...collectedMetadata, ...mod.metadata };
        }

        if (typeof mod.generateMetadata === "function") {
          try {
            const params = flattenRouteParams(options?.params);
            const query = options?.url ? Object.fromEntries(options.url.searchParams) : {};

            const gen = await mod.generateMetadata({
              params,
              query,
              slug,
              path,
              frontmatter: frontmatter || {},
            });

            if (gen && typeof gen === "object") {
              collectedMetadata = { ...collectedMetadata, ...(gen as Record<string, unknown>) };
            }
          } catch (e) {
            const normalizedError = ensureError(e);
            logger.warn("generateMetadata threw for MDX page", {
              error: normalizedError.message,
              slug,
              path,
            });
            throw normalizedError;
          }
        }

        // Get project's React for createElement to ensure element symbols match user components
        const React = await getProjectReact(options?.reactVersion);
        const pageElement = React.createElement(
          MDXComp as BundledReact.ComponentType<{ components?: MDXComponents }>,
          { components: mergedComponents },
        ) as BundledReact.ReactElement;

        return { pageElement, pageBundle, collectedMetadata };
      };

      try {
        return await loadPageElement();
      } catch (error) {
        if (isMdxEsmExportMismatchError(error)) {
          let recovered = false;

          try {
            recovered = await recoverStaleMdxEsmPreviewCaches({
              adapter,
              projectId: options?.projectId,
              projectSlug: options?.projectSlug,
              contentSourceId: options?.contentSourceId,
              slug,
              pagePath: path,
              mode: options?.mode,
            });
          } catch (recoveryError) {
            logger.warn("Failed to recover stale MDX ESM preview caches", {
              slug,
              path,
              error: getErrorMessage(recoveryError),
            });
          }

          if (recovered) {
            try {
              return await loadPageElement();
            } catch (retryError) {
              throw RENDER_ERROR.create({
                detail: `Failed to import MDX page via ESM after cache refresh: ${
                  getErrorMessage(retryError)
                }`,
                context: { slug, error: retryError, recoveredFrom: error },
              });
            }
          }
        }

        throw RENDER_ERROR.create({
          detail: `Failed to import MDX page via ESM: ${getErrorMessage(error)}`,
          context: { slug, error },
        });
      }
    },
    { "rendering.slug": slug, "rendering.pagePath": pageInfo.entity.path },
  );
}
