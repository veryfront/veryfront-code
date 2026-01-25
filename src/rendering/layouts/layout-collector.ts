import { join } from "#veryfront/platform/compat/path-helper.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { parallelFind } from "#veryfront/utils/parallel.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { EntityInfo, LayoutItem, MdxBundle } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { getLayoutEntity } from "#veryfront/types/entities/getEntityInfo.ts";
import { discoverNestedLayouts } from "./utils/discovery.ts";
import { detectAppRouter } from "../router-detection.ts";
import { LAYOUT_EXTENSIONS } from "./types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

function getLayoutKind(path: string): "mdx" | "tsx" {
  return path.endsWith(".mdx") || path.endsWith(".md") ? "mdx" : "tsx";
}

function isValidLayoutPath(layout: string): boolean {
  return /\.(tsx|jsx|ts|js|mdx|md)$/.test(layout);
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
      const kind = getLayoutKind(layoutPath);
      const nestedLayouts: LayoutItem[] = [
        {
          kind,
          bundle: kind === "mdx" ? layoutBundle : undefined,
          componentPath: kind === "tsx" ? layoutPath : undefined,
          path: layoutPath,
        },
      ];

      logger.debug("[LayoutCollector] Using frontmatter layout as nestedLayout", {
        layoutPath,
        layoutName,
        kind,
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
      nestedLayouts = [
        {
          kind,
          bundle: kind === "mdx" ? layoutBundle : undefined,
          componentPath: kind === "tsx" ? layoutPath : undefined,
          path: layoutPath,
        },
        ...nestedLayouts,
      ];

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

    const fs = this.adapter?.fs;
    const isVeryfrontAPI = !!fs && isExtendedFSAdapter(fs) && fs.isVeryfrontAdapter();

    if (isVeryfrontAPI && fs && isExtendedFSAdapter(fs)) {
      return await this.collectAPILayoutConfiguration(fs.getUnderlyingAdapter());
    }

    return await this.collectFilesystemLayouts(pageFilePath, useAppRouter);
  }

  private async collectAPILayoutConfiguration(wrappedAdapter: unknown): Promise<LayoutItem[]> {
    const nestedLayouts: LayoutItem[] = [];
    const configLayout = this.config?.layout;

    if (configLayout === false) {
      logger.debug("[LayoutCollector] Layout disabled via config.layout: false");
      return nestedLayouts;
    }

    const existsFn = (wrappedAdapter as { exists: (path: string) => Promise<boolean> }).exists;

    if (configLayout && isValidLayoutPath(configLayout)) {
      const layoutPath = configLayout.startsWith("/") || configLayout.startsWith(this.projectDir)
        ? configLayout
        : join(this.projectDir, configLayout);

      const layoutExists = await existsFn.call(wrappedAdapter, layoutPath);

      logger.debug("[LayoutCollector] Checking config layout", {
        configLayout,
        layoutPath,
        exists: layoutExists,
      });

      if (!layoutExists) {
        throw new Error(
          `Layout file not found: "${configLayout}" (resolved to "${layoutPath}"). ` +
            `Check your veryfront.config.ts 'layout' setting.`,
        );
      }

      const kind = getLayoutKind(configLayout);
      if (kind === "mdx") {
        const content = await this.adapter.fs.readFile(layoutPath);
        const bundle = await this.compileMDX(content, { isLayout: true }, layoutPath);
        nestedLayouts.push({ kind: "mdx", bundle, path: layoutPath });
      } else {
        nestedLayouts.push({
          kind: "tsx",
          component: undefined,
          componentPath: layoutPath,
          path: layoutPath,
        });
      }

      logger.debug("[LayoutCollector] Added config layout to nestedLayouts", { layoutPath, kind });
      return nestedLayouts;
    }

    if (!configLayout) {
      const foundExt = await parallelFind([...LAYOUT_EXTENSIONS], async (ext) => {
        const layoutPath = join(this.projectDir, "components", `layout.${ext}`);
        return await existsFn.call(wrappedAdapter, layoutPath);
      });

      if (foundExt) {
        const defaultLayoutPath = join(this.projectDir, "components", `layout.${foundExt}`);
        const kind = getLayoutKind(defaultLayoutPath);
        nestedLayouts.push({
          kind,
          component: undefined,
          componentPath: defaultLayoutPath,
          path: defaultLayoutPath,
        });

        logger.debug(`[LayoutCollector] Added default components/layout.${foundExt}`, {
          layoutPath: defaultLayoutPath,
        });
      }
    }

    return nestedLayouts;
  }

  private async collectFilesystemLayouts(
    pageFilePath: string,
    useAppRouter: boolean,
  ): Promise<LayoutItem[]> {
    const rootDir = useAppRouter ? join(this.projectDir, "app") : join(this.projectDir, "pages");
    return await discoverNestedLayouts(pageFilePath, rootDir, this.projectDir, this.adapter);
  }
}
