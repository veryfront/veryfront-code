import { rendererLogger as logger } from "#veryfront/utils";
import { VeryfrontError } from "#veryfront/errors/index.ts";
import { RENDER_ERROR } from "#veryfront/errors/error-registry.ts";
import type * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo, MdxBundle, MDXComponents, MDXModule, PageBundle } from "#veryfront/types";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { getProjectReact } from "#veryfront/react";
import { compileContent } from "#veryfront/transforms/mdx/compiler/index.ts";
import { ensureError, getErrorMessage } from "../errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export interface MDXPageResult {
  pageElement: BundledReact.ReactElement;
  pageBundle: PageBundle;
  collectedMetadata: Record<string, unknown>;
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
      const { frontmatter, content, path } = pageInfo.entity;
      const fmArg = frontmatter && Object.keys(frontmatter).length > 0 ? frontmatter : undefined;

      const ssrBundle = await compileContent(
        "development",
        projectDir,
        content,
        fmArg,
        path,
        "server",
      );

      const pageBundle = ssrBundle as PageBundle;
      let collectedMetadata: Record<string, unknown> = {};

      try {
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
          );
          pageBundle.clientModuleCode = browserBundle.compiledCode;
        }

        const clientModuleCode = pageBundle.clientModuleCode;
        if (!clientModuleCode) {
          throw new VeryfrontError(
            "MDX compilation produced no client module code",
            {
              slug: RENDER_ERROR.slug,
              category: RENDER_ERROR.category,
              status: RENDER_ERROR.status,
              title: RENDER_ERROR.title,
              suggestion: RENDER_ERROR.suggestion,
            },
          );
        }

        const mod = (await mdxRenderer.loadModuleESM(
          clientModuleCode,
          adapter,
          options?.projectId,
          projectDir,
          options?.projectSlug,
          options?.contentSourceId,
        )) as MDXModule;

        const MDXComp = mod.MDXContent || mod.default;
        if (!MDXComp) {
          throw new VeryfrontError(
            "Compiled MDX module has no content export",
            {
              slug: RENDER_ERROR.slug,
              category: RENDER_ERROR.category,
              status: RENDER_ERROR.status,
              title: RENDER_ERROR.title,
              suggestion: RENDER_ERROR.suggestion,
            },
          );
        }

        if (mod.metadata && typeof mod.metadata === "object") {
          collectedMetadata = { ...collectedMetadata, ...mod.metadata };
        }

        if (typeof mod.generateMetadata === "function") {
          try {
            const params = options?.params
              ? (Object.fromEntries(
                Object.entries(options.params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
              ) as Record<string, string>)
              : {};

            const gen = await mod.generateMetadata({
              params,
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
      } catch (error) {
        throw new VeryfrontError(
          `Failed to import MDX page via ESM: ${getErrorMessage(error)}`,
          {
            slug: RENDER_ERROR.slug,
            category: RENDER_ERROR.category,
            status: RENDER_ERROR.status,
            title: RENDER_ERROR.title,
            suggestion: RENDER_ERROR.suggestion,
            context: { slug, error },
          },
        );
      }
    },
    { "rendering.slug": slug, "rendering.pagePath": pageInfo.entity.path },
  );
}
