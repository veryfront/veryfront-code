import { rendererLogger as logger } from "@veryfront/utils";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { EntityInfo, MdxBundle, MDXComponents, MDXModule, PageBundle } from "@veryfront/types";
import { mdxRenderer } from "@veryfront/transforms/mdx/index.ts";
import { getProjectReact } from "@veryfront/react";
import { compileMDXRuntime } from "@veryfront/transforms/mdx/compiler/index.ts";
import { ensureError, getErrorMessage } from "../core/errors/veryfront-error.ts";

export interface MDXPageResult {
  pageElement: BundledReact.ReactElement;
  pageBundle: PageBundle;
  collectedMetadata: Record<string, unknown>;
}

export async function handleMDXPage(
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
  },
): Promise<MDXPageResult> {
  const fmArg = pageInfo.entity.frontmatter && Object.keys(pageInfo.entity.frontmatter).length > 0
    ? pageInfo.entity.frontmatter
    : undefined;

  const ssrBundle = await compileMDXRuntime(
    "development",
    projectDir,
    pageInfo.entity.content,
    fmArg,
    pageInfo.entity.path,
    "server",
    undefined,
    { studioEmbed: options?.studioEmbed },
  );
  const pageBundle = ssrBundle as MdxBundle;

  let collectedMetadata: Record<string, unknown> = {};

  try {
    let moduleCode: string | undefined;
    if (options?.precompiledModule) {
      moduleCode = options.precompiledModule;
      (pageBundle as PageBundle).clientModuleCode = moduleCode;
    } else {
      const browserBundle = await compileMDXRuntime(
        "development",
        projectDir,
        pageInfo.entity.content,
        fmArg,
        pageInfo.entity.path,
        "browser", // Use browser target for client module
        undefined, // baseUrl
        { studioEmbed: options?.studioEmbed },
      );
      moduleCode = browserBundle.compiledCode;
      (pageBundle as PageBundle).clientModuleCode = moduleCode;
    }

    const clientModuleCode = (pageBundle as PageBundle).clientModuleCode;
    if (!clientModuleCode) {
      throw new VeryfrontError(
        "MDX compilation produced no client module code",
        ErrorCode.RENDER_ERROR,
      );
    }
    const mod = (await mdxRenderer.loadModuleESM(
      clientModuleCode,
      adapter,
      options?.projectId,
      projectDir,
      options?.projectSlug,
    )) as MDXModule;
    const MDXComp = mod.MDXContent || mod.default;
    if (!MDXComp) {
      throw new VeryfrontError("Compiled MDX module has no content export", ErrorCode.RENDER_ERROR);
    }
    if (mod.metadata && typeof mod.metadata === "object") {
      collectedMetadata = {
        ...collectedMetadata,
        ...mod.metadata,
      };
    }

    try {
      if (typeof mod.generateMetadata === "function") {
        const gen = await mod.generateMetadata({
          params: options?.params
            ? (Object.fromEntries(
              Object.entries(options.params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
            ) as Record<string, string>)
            : {},
          slug,
          path: pageInfo.entity.path,
          frontmatter: pageInfo.entity.frontmatter || {},
        });
        if (gen && typeof gen === "object") {
          collectedMetadata = {
            ...collectedMetadata,
            ...(gen as Record<string, unknown>),
          };
        }
      }
    } catch (e) {
      const error = ensureError(e);
      logger.warn("generateMetadata threw for MDX page", error);
      // Re-throw if this was a critical error (not just missing metadata)
      if (error.message.includes("ReferenceError") || error.message.includes("SyntaxError")) {
        throw error;
      }
    }
    // Get project's React for createElement to ensure element symbols match user components
    const React = await getProjectReact();
    const pageElement = React.createElement(
      MDXComp as BundledReact.ComponentType<{ components?: MDXComponents }>,
      {
        components: mergedComponents,
      },
    ) as BundledReact.ReactElement;

    return {
      pageElement,
      pageBundle: pageBundle as PageBundle,
      collectedMetadata,
    };
  } catch (error) {
    throw new VeryfrontError(
      `Failed to import MDX page via ESM: ${getErrorMessage(error)}`,
      ErrorCode.RENDER_ERROR,
      { slug, error },
    );
  }
}
