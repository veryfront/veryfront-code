import { rendererLogger as logger } from "#veryfront/utils";
import { RENDER_ERROR, ensureError, getErrorMessage } from "#veryfront/errors";
import type * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo, MdxBundle, MDXComponents, MDXModule, PageBundle } from "#veryfront/types";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { clearMdxEsmCacheNamespace } from "#veryfront/transforms/mdx/esm-module-loader/index.ts";
import { getProjectReact } from "#veryfront/react";
import { flattenRouteParams } from "#veryfront/routing";
import { compileContent } from "#veryfront/transforms/mdx/compiler/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

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
}

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

export async function recoverStaleMdxEsmPreviewCaches(
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

        const mod = (await mdxRenderer.loadModuleESM(
          serverModuleCode,
          adapter,
          options?.projectId,
          projectDir,
          options?.projectSlug,
          options?.contentSourceId,
        )) as MDXModule;

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
        const React = await getProjectReact();
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
