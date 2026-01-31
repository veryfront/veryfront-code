import { join } from "#veryfront/platform/compat/path-helper.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo, LayoutItem, MdxBundle } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { getLayoutEntity } from "#veryfront/types/entities/getEntityInfo.ts";
import { discoverNestedLayouts } from "./utils/discovery.ts";
import { detectAppRouter } from "../router-detection.ts";
import { LAYOUT_EXTENSIONS, type LayoutExtension } from "./types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

function getLayoutKind(path: string): "mdx" | "tsx" {
  return path.endsWith(".mdx") || path.endsWith(".md") ? "mdx" : "tsx";
}

/**
 * Creates a LayoutItem from a path. For tsx/jsx/ts/js files, creates a tsx kind item.
 * For mdx/md files, creates an mdx kind item with optional bundle.
 */
function createLayoutItem(layoutPath: string, bundle?: MdxBundle): LayoutItem {
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
    if (await checker.exists(layoutPath)) {
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
    return withSpan(
      SpanNames.LAYOUT_COLLECT,
      async () => {
        const pagePath = pageInfo.entity.path;

        logger.debug("[LayoutCollector] collectLayouts called", {
          pagePath,
          projectDir: this.projectDir,
          hasConfig: !!this.config,
          layout: this.config?.layout,
        });

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

        return this.processLayoutResult(
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
      logger.debug("[LayoutCollector] Using frontmatter layout as nestedLayout", {
        layoutPath,
        layoutName,
        kind: getLayoutKind(layoutPath),
      });

      return {
        layoutBundle: undefined,
        nestedLayouts: [createLayoutItem(layoutPath, layoutBundle)],
      };
    }

    let nestedLayouts = await withSpan(
      SpanNames.LAYOUT_COLLECT_NESTED,
      () => this.collectNestedLayouts(pageInfo),
      { "layout.page_path": pageInfo.entity.path },
    );

    // If no layout path is set, return without adding config layout
    // Note: layoutBundle can be undefined for TSX layouts (they don't need MDX compilation)
    // but layoutPath will still be set if a config.layout was specified
    if (!layoutPath) {
      logger.debug("[LayoutCollector] collectLayouts result - no layout path", {
        hasLayoutBundle: !!layoutBundle,
        hasExplicitFrontmatterLayout,
        nestedLayoutsCount: nestedLayouts.length,
      });

      return { layoutBundle, nestedLayouts };
    }

    if (nestedLayouts.some((l) => l.path === layoutPath)) {
      logger.debug("[LayoutCollector] Skipping config.layout - already in nestedLayouts", {
        layoutPath,
      });
      return { layoutBundle: undefined, nestedLayouts };
    }

    nestedLayouts = [createLayoutItem(layoutPath, layoutBundle), ...nestedLayouts];

    logger.debug("[LayoutCollector] Added config.layout to nestedLayouts for client hydration", {
      layoutPath,
      kind: getLayoutKind(layoutPath),
      totalNestedLayouts: nestedLayouts.length,
    });

    return { layoutBundle: undefined, nestedLayouts };
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

    const layoutName = this.resolveLayoutName(layoutValue);

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

  private resolveLayoutName(layoutValue: string | boolean | undefined): string | null {
    if (layoutValue === false || layoutValue === "false") {
      return null;
    }

    if (typeof layoutValue === "string" && layoutValue.length > 0) {
      return layoutValue;
    }

    if (this.config?.layout === false) {
      return null;
    }

    if (typeof this.config?.layout === "string" && this.config.layout.length > 0) {
      return this.config.layout;
    }

    return null;
  }

  private async collectNestedLayouts(pageInfo: EntityInfo): Promise<LayoutItem[]> {
    const pageFilePath = pageInfo.entity.path;
    const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter);

    // Unified path for ALL adapters - discoverNestedLayouts uses adapter.fs.stat()
    // which works for both filesystem and API adapters
    return this.collectLayoutsUnified(pageFilePath, useAppRouter);
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

    if (nestedLayouts.length > 0) {
      logger.debug("[LayoutCollector] Found nested layouts", {
        count: nestedLayouts.length,
        paths: nestedLayouts.map((l) => l.path),
      });
      return nestedLayouts;
    }

    return this.checkComponentsLayoutFallback();
  }

  /**
   * Check for components/layout.* as a fallback when no nested layouts are found.
   * This provides consistent behavior between filesystem and API adapters.
   *
   * IMPORTANT: If config.layout is set, skip this fallback - config takes priority
   * over convention-based discovery.
   */
  private async checkComponentsLayoutFallback(): Promise<LayoutItem[]> {
    // If config.layout is set, don't use convention-based fallback
    if (typeof this.config?.layout === "string" && this.config.layout.length > 0) {
      logger.debug(
        "[LayoutCollector] Skipping components/layout fallback - config.layout takes priority",
        {
          configLayout: this.config.layout,
        },
      );
      return [];
    }

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
    if (getLayoutKind(layoutPath) !== "mdx") {
      return createLayoutItem(layoutPath);
    }

    const content = await this.adapter.fs.readFile(layoutPath);
    const bundle = await this.compileMDX(content, { isLayout: true }, layoutPath);
    return createLayoutItem(layoutPath, bundle);
  }
}
