import { join } from "../../platform/compat/path-helper.js";
import { rendererLogger as logger } from "../../utils/index.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { EntityInfo, LayoutItem, MdxBundle } from "../../types/index.js";
import type { VeryfrontConfig } from "../../config/index.js";
import { getLayoutEntity } from "../../types/entities/getEntityInfo.js";
import { discoverNestedLayouts } from "./utils/discovery.js";
import { detectAppRouter } from "../router-detection.js";
import { LAYOUT_EXTENSIONS, type LayoutExtension } from "./types.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../observability/tracing/span-names.js";

function getLayoutKind(path: string): "mdx" | "tsx" {
  return path.endsWith(".mdx") || path.endsWith(".md") ? "mdx" : "tsx";
}

/**
 * Creates a LayoutItem from a path. For tsx/jsx/ts/js files, creates a tsx kind item.
 * For mdx/md files, creates an mdx kind item with optional bundle.
 */
function createLayoutItem(
  layoutPath: string,
  bundle?: MdxBundle,
): LayoutItem {
  const kind = getLayoutKind(layoutPath);
  if (kind === "mdx") {
    return { kind: "mdx", bundle, path: layoutPath };
  }
  return {
    kind: "tsx",
    component: undefined,
    componentPath: layoutPath,
    path: layoutPath,
  };
}

/**
 * FileExistenceChecker is a pure interface for checking file existence.
 * This allows unit testing without mocking the full adapter.
 */
export interface FileExistenceChecker {
  exists(path: string): Promise<boolean>;
}

/**
 * Discovers a components/layout.* file in the given project directory.
 * Returns the full path if found, or null if no layout file exists.
 *
 * This is a pure function that can be unit tested without mocking the full adapter.
 */
export async function discoverComponentsLayoutPath(
  projectDir: string,
  checker: FileExistenceChecker,
): Promise<string | null> {
  for (const ext of LAYOUT_EXTENSIONS) {
    const layoutPath = join(projectDir, "components", `layout.${ext}`);
    const exists = await checker.exists(layoutPath);
    if (exists) {
      return layoutPath;
    }
  }
  return null;
}

/**
 * Result from discovering a components layout file.
 */
export interface ComponentsLayoutDiscoveryResult {
  layoutPath: string;
  extension: LayoutExtension;
}

export interface LayoutCollectionResult {
  layoutBundle: MdxBundle | undefined;
  nestedLayouts: LayoutItem[];
}

export interface LayoutCollectorOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>;
}

export class LayoutCollector {
  private projectDir: string;
  private adapter: RuntimeAdapter;
  private config: VeryfrontConfig;
  private compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>;

  constructor(options: LayoutCollectorOptions) {
    this.projectDir = options.projectDir;
    this.adapter = options.adapter;
    this.config = options.config;
    this.compileMDX = options.compileMDX;
  }

  async collectLayouts(pageInfo: EntityInfo): Promise<LayoutCollectionResult> {
    return await withSpan(
      SpanNames.LAYOUT_COLLECT,
      async () => {
        logger.debug("[LayoutCollector] collectLayouts called", {
          pagePath: pageInfo.entity.path,
          projectDir: this.projectDir,
          hasConfig: !!this.config,
          layout: this.config?.layout,
        });

        const pagePath = pageInfo.entity.path;

        if (pagePath.includes("/.veryfront/") || pagePath.includes(".veryfront/")) {
          logger.debug("[LayoutCollector] Skipping layouts for .veryfront path", { pagePath });
          return { layoutBundle: undefined, nestedLayouts: [] };
        }

        const layoutValue = pageInfo.entity.frontmatter.layout as string | boolean | undefined;
        if (layoutValue === false || layoutValue === "false") {
          logger.debug("[LayoutCollector] Layout explicitly disabled via frontmatter", {
            pagePath,
            layoutValue,
          });
          return { layoutBundle: undefined, nestedLayouts: [] };
        }

        const hasExplicitFrontmatterLayout = typeof layoutValue === "string" &&
          layoutValue.length > 0;

        const { layoutBundle, layoutPath, layoutName } = await withSpan(
          SpanNames.LAYOUT_COLLECT_NAMED,
          () => this.collectNamedLayoutWithPath(pageInfo),
          {
            "layout.page_path": pagePath,
            "layout.config_layout": this.config?.layout || "none",
          },
        );

        return await this.processLayoutResult(
          pageInfo,
          hasExplicitFrontmatterLayout,
          layoutBundle,
          layoutPath,
          layoutName,
        );
      },
      {
        "layout.page_path": pageInfo.entity.path,
        "layout.project_dir": this.projectDir,
      },
    );
  }

  private async processLayoutResult(
    pageInfo: EntityInfo,
    hasExplicitFrontmatterLayout: boolean,
    layoutBundle: MdxBundle | undefined,
    layoutPath: string | undefined,
    layoutName: string | undefined,
  ): Promise<LayoutCollectionResult> {
    if (hasExplicitFrontmatterLayout && layoutPath) {
      const nestedLayouts: LayoutItem[] = [createLayoutItem(layoutPath, layoutBundle)];

      logger.debug("[LayoutCollector] Using frontmatter layout as nestedLayout", {
        layoutPath,
        layoutName,
        kind: getLayoutKind(layoutPath),
      });

      return { layoutBundle: undefined, nestedLayouts };
    }

    let nestedLayouts = await withSpan(
      SpanNames.LAYOUT_COLLECT_NESTED,
      () => this.collectNestedLayouts(pageInfo),
      { "layout.page_path": pageInfo.entity.path },
    );

    if (layoutBundle && layoutPath) {
      const alreadyExists = nestedLayouts.some((l) => l.path === layoutPath);
      if (alreadyExists) {
        logger.debug("[LayoutCollector] Skipping config.layout - already in nestedLayouts", {
          layoutPath,
        });
        return { layoutBundle: undefined, nestedLayouts };
      }

      const kind = getLayoutKind(layoutPath);
      nestedLayouts = [createLayoutItem(layoutPath, layoutBundle), ...nestedLayouts];

      logger.debug("[LayoutCollector] Added config.layout to nestedLayouts for client hydration", {
        layoutPath,
        kind,
        totalNestedLayouts: nestedLayouts.length,
      });

      return { layoutBundle: undefined, nestedLayouts };
    }

    logger.debug("[LayoutCollector] collectLayouts result", {
      hasLayoutBundle: !!layoutBundle,
      hasExplicitFrontmatterLayout,
      nestedLayoutsCount: nestedLayouts.length,
    });

    return { layoutBundle, nestedLayouts };
  }

  private async collectNamedLayoutWithPath(pageInfo: EntityInfo): Promise<{
    layoutBundle: MdxBundle | undefined;
    layoutPath: string | undefined;
    layoutName: string | undefined;
  }> {
    const layoutValue = pageInfo.entity.frontmatter.layout as string | boolean | undefined;

    logger.debug("[LayoutCollector] collectNamedLayoutWithPath called", {
      pagePath: pageInfo.entity.path,
      layoutValue,
      frontmatterKeys: Object.keys(pageInfo.entity.frontmatter),
      configLayout: this.config?.layout,
    });

    let layoutName: string | null = null;

    if (layoutValue === false || layoutValue === "false") {
      layoutName = null;
    } else if (typeof layoutValue === "string" && layoutValue.length > 0) {
      layoutName = layoutValue;
    } else if (this.config?.layout === false) {
      layoutName = null;
    } else if (typeof this.config?.layout === "string" && this.config.layout.length > 0) {
      layoutName = this.config.layout;
    }

    logger.debug("[LayoutCollector] Resolved layoutName:", { layoutName });

    if (!layoutName) {
      return { layoutBundle: undefined, layoutPath: undefined, layoutName: undefined };
    }

    const layoutInfo = await withSpan(
      SpanNames.LAYOUT_GET_ENTITY,
      () => getLayoutEntity(this.projectDir, layoutName, this.adapter),
      { "layout.name": layoutName, "layout.project_dir": this.projectDir },
    );

    logger.debug("[LayoutCollector] Layout entity found:", { found: !!layoutInfo, layoutName });

    if (!layoutInfo) {
      const source = typeof layoutValue === "string" ? "frontmatter" : "config";
      throw new Error(
        `Layout "${layoutName}" not found. Specified in ${source} for page "${pageInfo.entity.path}". ` +
          `Check that the layout file exists.`,
      );
    }

    const layoutPath = layoutInfo.entity.path;
    const kind = getLayoutKind(layoutPath);

    logger.debug("Processing named layout", {
      layoutName,
      layoutPath,
      kind,
      contentLength: layoutInfo.entity.content.length,
    });

    if (kind === "tsx") {
      logger.debug("Named layout is TSX - skipping MDX compilation", { layoutPath });
      return { layoutBundle: undefined, layoutPath, layoutName };
    }

    const layoutBundle = await this.compileMDX(
      layoutInfo.entity.content,
      { ...layoutInfo.entity.frontmatter, isLayout: true },
      layoutPath,
    );

    logger.debug("Named Layout MDX compiled", {
      codeLength: layoutBundle.compiledCode?.length,
    });

    return { layoutBundle, layoutPath, layoutName };
  }

  private async collectNestedLayouts(pageInfo: EntityInfo): Promise<LayoutItem[]> {
    const pageFilePath = pageInfo.entity.path;
    const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter);

    // Unified path for ALL adapters - discoverNestedLayouts uses adapter.fs.stat()
    // which works for both filesystem and API adapters
    return await this.collectLayoutsUnified(pageFilePath, useAppRouter);
  }

  private async collectLayoutsUnified(
    pageFilePath: string,
    useAppRouter: boolean,
  ): Promise<LayoutItem[]> {
    const rootDir = useAppRouter ? join(this.projectDir, "app") : join(this.projectDir, "pages");

    logger.debug("[LayoutCollector] collectLayoutsUnified", {
      pageFilePath,
      useAppRouter,
      rootDir,
      projectDir: this.projectDir,
    });

    const nestedLayouts = await discoverNestedLayouts(
      pageFilePath,
      rootDir,
      this.projectDir,
      this.adapter,
    );

    // If nested layouts found, use them
    if (nestedLayouts.length > 0) {
      logger.debug("[LayoutCollector] Found nested layouts", {
        count: nestedLayouts.length,
        paths: nestedLayouts.map((l) => l.path),
      });
      return nestedLayouts;
    }

    // Fallback: check components/layout.*
    return await this.checkComponentsLayoutFallback();
  }

  /**
   * Check for components/layout.* as a fallback when no nested layouts are found.
   * This provides consistent behavior between filesystem and API adapters.
   */
  private async checkComponentsLayoutFallback(): Promise<LayoutItem[]> {
    const checker: FileExistenceChecker = {
      exists: async (path: string) => {
        try {
          const stat = await this.adapter.fs.stat(path);
          return stat.isFile;
        } catch {
          return false;
        }
      },
    };

    const layoutPath = await discoverComponentsLayoutPath(this.projectDir, checker);
    if (!layoutPath) {
      return [];
    }

    logger.debug("[LayoutCollector] Added fallback components layout", { layoutPath });
    return [await this.createLayoutItemWithBundle(layoutPath)];
  }

  /**
   * Creates a LayoutItem, compiling MDX content if needed.
   */
  private async createLayoutItemWithBundle(layoutPath: string): Promise<LayoutItem> {
    const kind = getLayoutKind(layoutPath);
    if (kind === "mdx") {
      const content = await this.adapter.fs.readFile(layoutPath);
      const bundle = await this.compileMDX(content, { isLayout: true }, layoutPath);
      return createLayoutItem(layoutPath, bundle);
    }
    return createLayoutItem(layoutPath);
  }
}
