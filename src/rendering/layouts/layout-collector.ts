import { join } from "#veryfront/platform/compat/path-helper.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { parallelFind } from "#veryfront/utils/parallel.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { EntityInfo } from "#veryfront/types";
import type { LayoutItem, MdxBundle } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { getLayoutEntity } from "#veryfront/types/entities/getEntityInfo.ts";
import { discoverNestedLayouts } from "./utils/discovery.ts";
import { detectAppRouter } from "../router-detection.ts";
import { LAYOUT_EXTENSIONS } from "./types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

/**
 * Determine layout kind based on file extension.
 * MDX/MD files use MDX rendering, all others use TSX component loading.
 */
function getLayoutKind(path: string): "mdx" | "tsx" {
  return path.endsWith(".mdx") || path.endsWith(".md") ? "mdx" : "tsx";
}

/**
 * Check if a layout value is a valid file path
 */
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

        // Skip layout resolution for .veryfront paths - these are framework-level pages
        // that should not use user-defined layouts
        if (
          pageInfo.entity.path.includes("/.veryfront/") ||
          pageInfo.entity.path.includes(".veryfront/")
        ) {
          logger.debug("[LayoutCollector] Skipping layouts for .veryfront path", {
            pagePath: pageInfo.entity.path,
          });
          return { layoutBundle: undefined, nestedLayouts: [] };
        }

        // Layout can be string, boolean (false to disable), or undefined
        const layoutValue = pageInfo.entity.frontmatter.layout as string | boolean | undefined;

        // Check if layout is explicitly disabled via `layout: false` or `layout: "false"`
        const layoutDisabled = layoutValue === false || layoutValue === "false";
        if (layoutDisabled) {
          logger.debug("[LayoutCollector] Layout explicitly disabled via frontmatter", {
            pagePath: pageInfo.entity.path,
            layoutValue,
          });
          return { layoutBundle: undefined, nestedLayouts: [] };
        }

        const hasExplicitFrontmatterLayout = typeof layoutValue === "string" &&
          layoutValue.length > 0;

        // Collect the named layout (from frontmatter or config.layout)
        const { layoutBundle, layoutPath, layoutName } = await withSpan(
          SpanNames.LAYOUT_COLLECT_NAMED,
          () => this.collectNamedLayoutWithPath(pageInfo),
          {
            "layout.page_path": pageInfo.entity.path,
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
    let nestedLayouts: LayoutItem[];

    if (hasExplicitFrontmatterLayout && layoutPath) {
      // Page has explicit frontmatter layout - use it INSTEAD of project-level layouts
      // This prevents double-wrapping (e.g., page's DocsLayoutV2 + project's DefaultLayout)
      // Include the frontmatter layout as a nestedLayout for client-side hydration
      // Use layoutPath (the resolved file path with extension) for kind detection
      const kind = getLayoutKind(layoutPath);
      nestedLayouts = [{
        kind,
        bundle: kind === "mdx" ? layoutBundle : undefined,
        componentPath: kind === "tsx" ? layoutPath : undefined,
        path: layoutPath,
      }];
      // Return undefined layoutBundle since we're using nestedLayouts for this layout
      // This ensures SSR and client hydration apply the same layout
      logger.debug("[LayoutCollector] Using frontmatter layout as nestedLayout", {
        layoutPath,
        layoutName,
        kind,
      });
      return { layoutBundle: undefined, nestedLayouts };
    } else {
      // No explicit frontmatter layout - use project-level nested layouts
      nestedLayouts = await withSpan(
        SpanNames.LAYOUT_COLLECT_NESTED,
        () => this.collectNestedLayouts(pageInfo),
        { "layout.page_path": pageInfo.entity.path },
      );

      // If we have a layoutBundle from config.layout, add it to nestedLayouts
      // so the client can apply the same layout during hydration
      // BUT: avoid duplicates if the same layout was already found via auto-discovery
      if (layoutBundle && layoutPath) {
        const alreadyExists = nestedLayouts.some((l) => l.path === layoutPath);
        if (!alreadyExists) {
          // Use layoutPath (the resolved file path with extension) for kind detection
          const kind = getLayoutKind(layoutPath);

          // Prepend the config layout to nestedLayouts (it wraps outermost)
          nestedLayouts = [{
            kind,
            bundle: kind === "mdx" ? layoutBundle : undefined,
            componentPath: kind === "tsx" ? layoutPath : undefined,
            path: layoutPath,
          }, ...nestedLayouts];

          logger.debug(
            "[LayoutCollector] Added config.layout to nestedLayouts for client hydration",
            {
              layoutPath,
              kind,
              totalNestedLayouts: nestedLayouts.length,
            },
          );
        } else {
          logger.debug(
            "[LayoutCollector] Skipping config.layout - already in nestedLayouts",
            { layoutPath },
          );
        }

        // Return undefined layoutBundle since we're now using nestedLayouts
        // This ensures SSR and client hydration apply layouts the same way
        return { layoutBundle: undefined, nestedLayouts };
      }
    }

    logger.debug("[LayoutCollector] collectLayouts result", {
      hasLayoutBundle: !!layoutBundle,
      hasExplicitFrontmatterLayout,
      nestedLayoutsCount: nestedLayouts.length,
    });

    return { layoutBundle, nestedLayouts };
  }

  private async collectNamedLayoutWithPath(
    pageInfo: EntityInfo,
  ): Promise<
    {
      layoutBundle: MdxBundle | undefined;
      layoutPath: string | undefined;
      layoutName: string | undefined;
    }
  > {
    const layoutValue = pageInfo.entity.frontmatter.layout as string | boolean | undefined;

    logger.debug("[LayoutCollector] collectNamedLayoutWithPath called", {
      pagePath: pageInfo.entity.path,
      layoutValue,
      frontmatterKeys: Object.keys(pageInfo.entity.frontmatter),
      configLayout: this.config?.layout,
    });

    // Determine layout name from frontmatter or config
    // Priority: frontmatter.layout > config.layout > null
    // Both support `false` to explicitly disable layout
    let layoutName: string | null = null;

    // Check frontmatter first
    if (layoutValue === false || layoutValue === "false") {
      // Frontmatter explicitly disables layout
      layoutName = null;
    } else if (typeof layoutValue === "string" && layoutValue.length > 0) {
      // Frontmatter specifies a layout
      layoutName = layoutValue;
    } else if (this.config?.layout === false) {
      // Config explicitly disables layout
      layoutName = null;
    } else if (typeof this.config?.layout === "string" && this.config.layout.length > 0) {
      // Config specifies a layout
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
      // Layout was explicitly specified but not found - this is an error
      const source = typeof layoutValue === "string" ? "frontmatter" : "config";
      throw new Error(
        `Layout "${layoutName}" not found. Specified in ${source} for page "${pageInfo.entity.path}". ` +
          `Check that the layout file exists.`,
      );
    }

    logger.debug("Compiling named layout", {
      layoutName,
      contentLength: layoutInfo.entity.content.length,
    });

    const layoutBundle = await this.compileMDX(
      layoutInfo.entity.content,
      { ...layoutInfo.entity.frontmatter, isLayout: true },
      layoutInfo.entity.path,
    );

    logger.debug("Named Layout MDX compiled", {
      codeLength: layoutBundle.compiledCode?.length,
    });

    return { layoutBundle, layoutPath: layoutInfo.entity.path, layoutName };
  }

  private async collectNestedLayouts(pageInfo: EntityInfo): Promise<LayoutItem[]> {
    const pageFilePath = pageInfo.entity.path;
    const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter);

    // Check if using Veryfront API adapter via wrapper methods
    const fs = this.adapter?.fs;
    const isVeryfrontAPI = fs && isExtendedFSAdapter(fs) && fs.isVeryfrontAdapter();

    logger.debug("[LayoutCollector] Checking FS adapter type", {
      hasAdapter: !!this.adapter,
      hasFs: !!fs,
      wrapperName: fs?.constructor?.name,
      isVeryfrontAPI,
    });

    if (isVeryfrontAPI && isExtendedFSAdapter(fs)) {
      return await this.collectAPILayoutConfiguration(fs.getUnderlyingAdapter());
    }
    return await this.collectFilesystemLayouts(pageFilePath, useAppRouter);
  }

  private async collectAPILayoutConfiguration(wrappedAdapter: unknown): Promise<LayoutItem[]> {
    const nestedLayouts: LayoutItem[] = [];

    // Priority 1: Check config.layout from veryfront.config.ts
    const configLayout = this.config?.layout;

    // layout: false explicitly disables layout
    if (configLayout === false) {
      logger.debug("[LayoutCollector] Layout disabled via config.layout: false");
      return nestedLayouts;
    }

    if (configLayout && isValidLayoutPath(configLayout)) {
      // Config layout can be absolute or relative to project
      const layoutPath = configLayout.startsWith("/") || configLayout.startsWith(this.projectDir)
        ? configLayout
        : join(this.projectDir, configLayout);

      const layoutExists = await (wrappedAdapter as { exists: (path: string) => Promise<boolean> })
        .exists(layoutPath);

      logger.debug("[LayoutCollector] Checking config layout", {
        configLayout,
        layoutPath,
        exists: layoutExists,
      });

      if (layoutExists) {
        const kind = getLayoutKind(configLayout);
        if (kind === "mdx") {
          // For MDX layouts, we need to compile them first
          const content = await this.adapter.fs.readFile(layoutPath);
          const bundle = await this.compileMDX(content, { isLayout: true }, layoutPath);
          nestedLayouts.push({
            kind: "mdx",
            bundle,
            path: layoutPath,
          });
        } else {
          nestedLayouts.push({
            kind: "tsx",
            component: undefined,
            componentPath: layoutPath,
            path: layoutPath,
          });
        }

        logger.debug("[LayoutCollector] Added config layout to nestedLayouts", {
          layoutPath,
          kind,
        });
        return nestedLayouts;
      } else {
        // config.layout is explicitly set but file doesn't exist - this is an error
        throw new Error(
          `Layout file not found: "${configLayout}" (resolved to "${layoutPath}"). ` +
            `Check your veryfront.config.ts 'layout' setting.`,
        );
      }
    }

    // Priority 2: Convention fallback - auto-discover layout.* in components folder
    // This ONLY runs when config.layout is NOT set at all
    // Check all extensions in parallel, use first match by extension priority order
    if (nestedLayouts.length === 0 && !configLayout) {
      const existsFn = (wrappedAdapter as { exists: (path: string) => Promise<boolean> }).exists;
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
