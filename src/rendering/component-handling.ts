/**
 * Component Page Handling (TSX/JSX files)
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { ErrorCode, VeryfrontError } from "#veryfront/errors/index.ts";
import type * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo, PageBundle } from "#veryfront/types";
import { createError, getErrorMessage, toError } from "../errors/veryfront-error.ts";
import { getProjectReact } from "#veryfront/react";
import { injectNodePositions } from "../transforms/plugins/babel-node-positions.ts";
import { buildComponentCacheKey } from "../cache/keys.ts";

export interface ComponentPageResult {
  pageElement: BundledReact.ReactElement;
  pageBundle: PageBundle;
}

/**
 * Cache for transformed component hydration bundles.
 * Keys are content-addressed: `component:${projectId}:${filePath}:${sha256(source)}`.
 * Safe for multi-tenant use (project-scoped + content-hashed).
 * Evicted when exceeding MAX_COMPONENT_CACHE_SIZE to prevent unbounded memory growth.
 */
const MAX_COMPONENT_CACHE_SIZE = 5000;
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
    /** Content source ID for cache isolation (branch name or release ID) */
    contentSourceId?: string;
    /** React version for transforms (from project config) */
    reactVersion?: string;
  },
): Promise<ComponentPageResult> {
  try {
    logger.debug(`Loading TSX/JSX file: ${pageInfo.entity.path}`);

    const rawFileContent = await adapter.fs.readFile(pageInfo.entity.path);

    const fileContent = options?.studioEmbed
      ? injectNodePositions(rawFileContent, { filePath: pageInfo.entity.path })
      : rawFileContent;

    const clientModuleCode = options?.cachedClientModule ??
      (await bundleComponentForClient(
        fileContent,
        pageInfo.entity.path,
        projectDir,
        adapter,
        options?.moduleServerUrl,
        options?.projectId,
        options?.reactVersion,
      )) ??
      undefined;

    const { loadComponentFromSource } = await import("@veryfront/modules/react-loader/index.ts");
    const PageComponent = await loadComponentFromSource(
      fileContent,
      pageInfo.entity.path,
      projectDir,
      adapter,
      {
        projectId: options?.projectId ?? projectDir,
        dev: true,
        moduleServerUrl: options?.moduleServerUrl,
        ssr: true,
        contentSourceId: options?.contentSourceId,
        reactVersion: options?.reactVersion,
      },
    );

    if (!PageComponent) {
      throw toError(
        createError({
          type: "render",
          message: `Component does not export a default: ${pageInfo.entity.path}`,
        }),
      );
    }

    const React = await getProjectReact();
    const pageElement = React.createElement(
      PageComponent,
      options?.props ?? {},
    ) as BundledReact.ReactElement;

    const pageBundle: PageBundle = {
      compiledCode: "",
      frontmatter: pageInfo.entity.frontmatter ?? {},
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

const HEX_CHARS = "0123456789abcdef";

async function generateContentHash(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);

  let hex = "";
  for (let i = 0; i < 8; i++) {
    const byte = bytes[i]!;
    hex += HEX_CHARS.charAt(byte >> 4) + HEX_CHARS.charAt(byte & 0xf);
  }
  return hex;
}

async function bundleComponentForClient(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  moduleServerUrl?: string,
  projectId?: string,
  reactVersion?: string,
): Promise<string | null> {
  try {
    const contentHash = await generateContentHash(source);
    const cacheKey = buildComponentCacheKey(projectId ?? projectDir, filePath, contentHash);
    const cached = componentHydrationCache.get(cacheKey);
    if (cached) return cached;

    const { transformToESM } = await import("#veryfront/transforms/esm-transform.ts");
    const transformed = await transformToESM(source, filePath, projectDir, adapter, {
      projectId: projectId ?? projectDir,
      dev: true,
      jsxImportSource: "react",
      moduleServerUrl,
      reactVersion,
    });

    if (componentHydrationCache.size >= MAX_COMPONENT_CACHE_SIZE) {
      logger.debug("[ComponentHandling] Cache size limit reached, clearing", {
        size: componentHydrationCache.size,
        limit: MAX_COMPONENT_CACHE_SIZE,
      });
      componentHydrationCache.clear();
    }
    componentHydrationCache.set(cacheKey, transformed);
    return transformed;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error("Failed to transform component for client hydration", {
      filePath,
      error: errorMessage,
    });
    throw toError(
      createError({
        type: "render",
        message: `Component transformation failed for ${filePath}: ${errorMessage}`,
      }),
    );
  }
}
