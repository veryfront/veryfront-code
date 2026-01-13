/**
 * Component Page Handling (TSX/JSX files)
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { EntityInfo, PageBundle } from "@veryfront/types";
import { createError, getErrorMessage, toError } from "../core/errors/veryfront-error.ts";
import { getProjectReact } from "@veryfront/react";
import { injectNodePositions } from "../build/transforms/plugins/babel-node-positions.ts";

export interface ComponentPageResult {
  pageElement: BundledReact.ReactElement;
  pageBundle: PageBundle;
}

const componentHydrationCache = new Map<string, string>();

/**
 * Load and render a TSX/JSX component page
 */
export async function handleComponentPage(
  pageInfo: EntityInfo,
  slug: string,
  projectDir: string,
  _componentRegistry: unknown,
  adapter: RuntimeAdapter,
  options?: {
    props?: Record<string, unknown>;
    cachedClientModule?: string;
    moduleServerUrl?: string;
    /** Project ID for multi-project SSR module isolation */
    projectId?: string;
    /** Enable node position injection for Studio Navigator */
    studioEmbed?: boolean;
  },
): Promise<ComponentPageResult> {
  try {
    logger.debug(`Loading TSX/JSX file: ${pageInfo.entity.path}`);

    const rawFileContent = await adapter.fs.readFile(pageInfo.entity.path);

    // Inject node positions for Studio Navigator (edit-in-place support)
    // Only enabled when studioEmbed is true (page embedded in Studio iframe)
    const fileContent = options?.studioEmbed
      ? injectNodePositions(rawFileContent, { filePath: pageInfo.entity.path })
      : rawFileContent;

    // Bundle for client if not cached
    let clientModuleCode = options?.cachedClientModule;
    if (!clientModuleCode) {
      clientModuleCode = await bundleComponentForClient(
        fileContent,
        pageInfo.entity.path,
        projectDir,
        adapter,
        options?.moduleServerUrl,
        options?.projectId,
      ) ?? undefined;
    }

    // Load the component using NEW ESM component loader for SSR
    const { loadComponentFromSource } = await import(
      "@veryfront/modules/react-loader/index.ts"
    );
    const PageComponent = await loadComponentFromSource(
      fileContent,
      pageInfo.entity.path,
      projectDir,
      adapter,
      {
        projectId: options?.projectId || projectDir,
        dev: true,
        moduleServerUrl: options?.moduleServerUrl,
        ssr: true, // SSR mode for proper import resolution
      },
    );

    if (!PageComponent) {
      throw toError(createError({
        type: "render",
        message: `Component does not export a default: ${pageInfo.entity.path}`,
      }));
    }

    // Get project's React for createElement to ensure element symbols match user components
    const React = await getProjectReact();
    const componentProps = options?.props || {};
    const pageElement = React.createElement(
      PageComponent,
      componentProps,
    ) as BundledReact.ReactElement;

    const pageBundle: PageBundle = {
      compiledCode: "",
      frontmatter: pageInfo.entity.frontmatter || {},
      globals: {},
      headings: [],
      nodeMap: new Map(),
    } as PageBundle;

    if (clientModuleCode) {
      pageBundle.clientModuleCode = clientModuleCode;
    }

    logger.debug(`Successfully loaded TSX/JSX component for ${slug}`);

    return { pageElement, pageBundle };
  } catch (error) {
    logger.error(`Failed to import TSX/JSX file: ${pageInfo.entity.path}`, error);
    throw new VeryfrontError(
      `Failed to load TSX/JSX component: ${(error as Error).message}`,
      ErrorCode.RENDER_ERROR,
      { slug, error },
    );
  }
}

// Generate SHA-256 hash for content
async function generateContentHash(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function bundleComponentForClient(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  moduleServerUrl?: string,
  projectId?: string,
): Promise<string | null> {
  try {
    const cacheKey = `${projectId ?? projectDir}:${filePath}:${await generateContentHash(source)}`;
    const cached = componentHydrationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Use ESM transform instead of bundling (modern dev server pattern)
    // This works because the module server serves all dependencies via HTTP
    // and the browser natively supports ES modules
    const { transformToESM } = await import("@veryfront/transforms/esm-transform.ts");

    const transformed = await transformToESM(
      source,
      filePath,
      projectDir,
      adapter,
      {
        projectId: projectId ?? projectDir,
        dev: true,
        jsxImportSource: "react",
        moduleServerUrl,
      },
    );

    componentHydrationCache.set(cacheKey, transformed);
    return transformed;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error("Failed to transform component for client hydration", {
      filePath,
      error: errorMessage,
    });
    // Don't silently return null - throw to make the error visible
    throw toError(createError({
      type: "render",
      message: `Component transformation failed for ${filePath}: ${errorMessage}`,
    }));
  }
}
