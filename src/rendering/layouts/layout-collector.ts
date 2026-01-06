import { join } from "../../platform/compat/path-helper.ts";
import { rendererLogger as logger, timeAsync } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { EntityInfo } from "@veryfront/types";
import type { LayoutItem, MdxBundle } from "@veryfront/types";
import type { VeryfrontConfig } from "@veryfront/config";
import { getLayoutEntity } from "../../core/types/entities/getEntityInfo.ts";
import { discoverNestedLayouts } from "./utils/discovery.ts";
import { detectAppRouter } from "../router-detection.ts";

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
    const layoutValue = pageInfo.entity.frontmatter.layout;
    const hasExplicitFrontmatterLayout = typeof layoutValue === "string" && layoutValue.length > 0;

    // Collect the named layout (from frontmatter or config.defaultLayout)
    const { layoutBundle, layoutPath } = await timeAsync(
      "layout-named",
      () => this.collectNamedLayoutWithPath(pageInfo),
      "collect-layouts",
    );

    let nestedLayouts: LayoutItem[];

    if (hasExplicitFrontmatterLayout && layoutPath) {
      // Page has explicit frontmatter layout - use it INSTEAD of project-level layouts
      // This prevents double-wrapping (e.g., page's DocsLayoutV2 + project's DefaultLayout)
      // Include the frontmatter layout as a nestedLayout for client-side hydration
      const kind = layoutPath.endsWith(".mdx") ? "mdx" : "tsx";
      nestedLayouts = [{
        kind: kind as "mdx" | "tsx",
        bundle: kind === "mdx" ? layoutBundle : undefined,
        componentPath: kind === "tsx" ? layoutPath : undefined,
        path: layoutPath,
      }];
      // Return undefined layoutBundle since we're using nestedLayouts for this layout
      // This ensures SSR and client hydration apply the same layout
      logger.info("[LayoutCollector] Using frontmatter layout as nestedLayout", {
        layoutPath,
        kind,
      });
      return { layoutBundle: undefined, nestedLayouts };
    } else {
      // No explicit frontmatter layout - use project-level nested layouts
      nestedLayouts = await timeAsync(
        "layout-nested",
        () => this.collectNestedLayouts(pageInfo),
        "collect-layouts",
      );

      // If we have a layoutBundle from config.defaultLayout, add it to nestedLayouts
      // so the client can apply the same layout during hydration
      if (layoutBundle && layoutPath) {
        const kind = layoutPath.endsWith(".mdx") ? "mdx" : "tsx";

        // Prepend the defaultLayout to nestedLayouts (it wraps outermost)
        nestedLayouts = [{
          kind: kind as "mdx" | "tsx",
          bundle: kind === "mdx" ? layoutBundle : undefined,
          componentPath: kind === "tsx" ? layoutPath : undefined,
          path: layoutPath,
        }, ...nestedLayouts];

        logger.info("[LayoutCollector] Added defaultLayout to nestedLayouts for client hydration", {
          layoutPath,
          kind,
          totalNestedLayouts: nestedLayouts.length,
        });

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
  ): Promise<{ layoutBundle: MdxBundle | undefined; layoutPath: string | undefined }> {
    const layoutValue = pageInfo.entity.frontmatter.layout;

    logger.info("[LayoutCollector] collectNamedLayoutWithPath called", {
      pageId: pageInfo.entity.id,
      layoutValue,
      frontmatterKeys: Object.keys(pageInfo.entity.frontmatter),
      defaultLayout: this.config?.defaultLayout,
    });

    const layoutName = (typeof layoutValue === "boolean" && !layoutValue) || layoutValue === "false"
      ? null
      : (typeof layoutValue === "string" ? layoutValue : null) ||
        this.config?.defaultLayout ||
        null;

    logger.info("[LayoutCollector] Resolved layoutName:", { layoutName });

    if (!layoutName) {
      return { layoutBundle: undefined, layoutPath: undefined };
    }

    const layoutInfo = await getLayoutEntity(this.projectDir, layoutName, this.adapter);
    logger.info("[LayoutCollector] Layout entity found:", { found: !!layoutInfo, layoutName });

    if (!layoutInfo) {
      return { layoutBundle: undefined, layoutPath: undefined };
    }

    logger.debug("Compiling named layout", {
      layoutName,
      contentLength: layoutInfo.entity.content.length,
    });

    const layoutBundle = await this.compileMDX(
      layoutInfo.entity.content,
      { ...layoutInfo.entity.frontmatter, isLayout: true },
      layoutInfo.entity.id,
    );

    logger.debug("Named Layout MDX compiled", {
      codeLength: layoutBundle.compiledCode?.length,
    });

    return { layoutBundle, layoutPath: layoutInfo.entity.id };
  }

  private async collectNestedLayouts(pageInfo: EntityInfo): Promise<LayoutItem[]> {
    const pageFilePath = pageInfo.entity.id;
    const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter);

    const wrappedAdapter: unknown = (this.adapter?.fs as { fsAdapter?: unknown })?.fsAdapter;
    const isVeryfrontAPI =
      (wrappedAdapter as { constructor?: { name?: string } })?.constructor?.name ===
        "VeryfrontFSAdapter";

    logger.debug("[LayoutCollector] Checking FS adapter type", {
      hasAdapter: !!this.adapter,
      hasFs: !!this.adapter?.fs,
      wrapperName: this.adapter?.fs?.constructor?.name,
      wrappedAdapterName: (wrappedAdapter as { constructor?: { name?: string } })?.constructor
        ?.name,
      isVeryfrontAPI,
    });

    if (isVeryfrontAPI) {
      return await this.collectAPILayoutConfiguration(wrappedAdapter);
    } else {
      return await this.collectFilesystemLayouts(pageFilePath, useAppRouter);
    }
  }

  private async collectAPILayoutConfiguration(wrappedAdapter: unknown): Promise<LayoutItem[]> {
    const nestedLayouts: LayoutItem[] = [];

    // Check if layout value is a valid file path (not a UUID)
    // Valid paths end with .tsx, .jsx, .ts, .js, or .mdx
    const isValidLayoutPath = (layout: string): boolean => {
      return /\.(tsx|jsx|ts|js|mdx)$/.test(layout);
    };

    // Check if a string is a UUID
    const isUUID = (value: string): boolean => {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    };

    // Determine layout kind based on file extension
    const getLayoutKind = (layout: string): "tsx" | "mdx" => {
      return layout.endsWith(".mdx") ? "mdx" : "tsx";
    };

    // Priority 1: Check config.layout from veryfront.config.ts
    const configLayout = this.config?.layout;
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
      }
    }

    // Priority 2: Check project data (legacy, from API project settings)
    const projectData = (wrappedAdapter as {
      getProjectData: () => { provider?: string; layout?: string } | undefined;
    }).getProjectData();

    logger.debug("[LayoutCollector] Veryfront API project data", {
      provider: projectData?.provider,
      layout: projectData?.layout,
    });

    let layoutValue = projectData?.layout;

    // If layout is a UUID, try to resolve it to a file path via entity lookup
    // Also get the body content if available from components API
    let componentBody: string | undefined;

    if (layoutValue && isUUID(layoutValue)) {
      const vfAdapter = wrappedAdapter as {
        getFilePathByEntityId?: (entityId: string) => string | undefined;
        getFilePathByEntityIdAsync?: (
          entityId: string,
        ) => Promise<{ path: string; body?: string } | undefined>;
      };

      logger.info("[LayoutCollector] Attempting to resolve UUID layout", {
        uuid: layoutValue,
        hasSyncMethod: typeof vfAdapter.getFilePathByEntityId === "function",
        hasAsyncMethod: typeof vfAdapter.getFilePathByEntityIdAsync === "function",
      });

      // First try synchronous cache lookup
      let resolvedPath = vfAdapter.getFilePathByEntityId?.(layoutValue);
      logger.info("[LayoutCollector] Sync cache lookup result", {
        uuid: layoutValue,
        resolvedPath: resolvedPath ?? "(not found)",
      });

      // If not in cache, try async API lookup (which also returns body content)
      if (!resolvedPath && vfAdapter.getFilePathByEntityIdAsync) {
        logger.info("[LayoutCollector] Trying async API lookup", { uuid: layoutValue });
        const result = await vfAdapter.getFilePathByEntityIdAsync(layoutValue);
        if (result) {
          resolvedPath = result.path;
          componentBody = result.body;
        }
        logger.info("[LayoutCollector] Async API lookup result", {
          uuid: layoutValue,
          resolvedPath: resolvedPath ?? "(not found)",
          hasBody: !!componentBody,
        });
      }

      if (resolvedPath) {
        logger.info("[LayoutCollector] Resolved UUID layout to path", {
          uuid: layoutValue,
          path: resolvedPath,
          hasBody: !!componentBody,
        });
        layoutValue = resolvedPath;
      } else {
        logger.info("[LayoutCollector] Could not resolve UUID layout", {
          uuid: layoutValue,
        });
      }
    }

    logger.info("[LayoutCollector] Validating layout path", {
      layoutValue,
      isValid: layoutValue ? isValidLayoutPath(layoutValue) : false,
      hasComponentBody: !!componentBody,
    });

    if (layoutValue && isValidLayoutPath(layoutValue)) {
      // Use absolute path for component path
      const layoutPath = join(this.projectDir, layoutValue);

      // Determine layout kind - check content for frontmatter even if extension is .tsx
      // Component body from API may be MDX even with .tsx extension
      // BUT: If the body is ONLY frontmatter metadata (no content after ---),
      // treat it as TSX and load the actual file instead
      const hasFrontmatter = componentBody?.trimStart().startsWith("---");
      let hasContentAfterFrontmatter = false;
      if (hasFrontmatter && componentBody) {
        // Check if there's actual content after the frontmatter closing ---
        const trimmed = componentBody.trimStart();
        const firstClose = trimmed.indexOf("---", 3); // Find closing ---
        if (firstClose !== -1) {
          const afterFrontmatter = trimmed.slice(firstClose + 3).trim();
          hasContentAfterFrontmatter = afterFrontmatter.length > 0;
        }
      }
      // Only treat as MDX if there's actual content after frontmatter
      const kind = (hasFrontmatter && hasContentAfterFrontmatter)
        ? "mdx"
        : getLayoutKind(layoutValue);

      logger.info("[LayoutCollector] Content analysis", {
        hasFrontmatter,
        hasContentAfterFrontmatter,
        bodyLength: componentBody?.length,
        bodyPreview: componentBody?.substring(0, 200),
      });

      logger.info("[LayoutCollector] Determined layout kind", {
        layoutPath,
        kind,
        hasFrontmatter,
        extension: layoutValue.split(".").pop(),
      });

      // If we have body content from components API, use it directly
      // Otherwise check if file exists and read it
      let content: string | undefined = componentBody;
      let layoutAvailable = !!componentBody;

      if (!content) {
        // For Veryfront API adapter, use relative path for exists check
        const layoutExists =
          await (wrappedAdapter as { exists: (path: string) => Promise<boolean> })
            .exists(layoutValue);

        logger.info("[LayoutCollector] Checking API layout file", {
          layoutPath,
          layoutValue,
          exists: layoutExists,
        });

        if (layoutExists) {
          layoutAvailable = true;
          if (kind === "mdx") {
            content = await this.adapter.fs.readFile(layoutValue);
          }
        }
      } else {
        logger.info("[LayoutCollector] Using component body from API", {
          layoutPath,
          bodyLength: content.length,
        });
      }

      if (layoutAvailable) {
        if (kind === "mdx" && content) {
          // For MDX layouts, compile the content
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

        logger.info("[LayoutCollector] Added API layout to nestedLayouts", {
          layoutPath,
          kind,
          fromComponentBody: !!componentBody,
        });
      }
    } else if (projectData?.layout) {
      logger.debug("[LayoutCollector] Skipping invalid layout value (not a file path)", {
        layout: projectData.layout,
        resolved: layoutValue,
      });
    }

    // Also try to auto-discover layout.tsx in components folder
    // This provides a fallback when layout is not explicitly configured
    if (nestedLayouts.length === 0) {
      const defaultLayoutPath = join(this.projectDir, "components", "layout.tsx");
      const defaultLayoutExists =
        await (wrappedAdapter as { exists: (path: string) => Promise<boolean> })
          .exists(defaultLayoutPath);

      if (defaultLayoutExists) {
        nestedLayouts.push({
          kind: "tsx",
          component: undefined,
          componentPath: defaultLayoutPath,
          path: defaultLayoutPath,
        });

        logger.debug("[LayoutCollector] Added default components/layout.tsx", {
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

    const nestedLayouts = await discoverNestedLayouts(
      pageFilePath,
      rootDir,
      this.projectDir,
      this.adapter,
    );

    return nestedLayouts;
  }
}
