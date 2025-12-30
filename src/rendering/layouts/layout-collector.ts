import { join } from "../../platform/compat/path-helper.ts";
import { rendererLogger as logger } from "@veryfront/utils";
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
    const layoutBundle = await this.collectNamedLayout(pageInfo);
    const nestedLayouts = await this.collectNestedLayouts(pageInfo);

    return { layoutBundle, nestedLayouts };
  }

  private async collectNamedLayout(pageInfo: EntityInfo): Promise<MdxBundle | undefined> {
    const layoutValue = pageInfo.entity.frontmatter.layout;

    const layoutName = (typeof layoutValue === "boolean" && !layoutValue) || layoutValue === "false"
      ? null
      : (typeof layoutValue === "string" ? layoutValue : null) ||
        this.config?.defaultLayout ||
        null;

    if (!layoutName) {
      return undefined;
    }

    const layoutInfo = await getLayoutEntity(this.projectDir, layoutName, this.adapter);
    logger.debug("Layout entity found:", !!layoutInfo);

    if (!layoutInfo) {
      return undefined;
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

    return layoutBundle;
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
    // Valid paths end with .tsx, .jsx, .ts, or .js
    const isValidLayoutPath = (layout: string): boolean => {
      return /\.(tsx|jsx|ts|js)$/.test(layout);
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
        nestedLayouts.push({
          kind: "tsx",
          component: undefined,
          componentPath: layoutPath,
          path: layoutPath,
        });

        logger.debug("[LayoutCollector] Added config layout to nestedLayouts", {
          layoutPath,
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

    if (projectData?.layout && isValidLayoutPath(projectData.layout)) {
      const layoutPath = join(this.projectDir, "components", projectData.layout);
      const layoutExists = await (wrappedAdapter as { exists: (path: string) => Promise<boolean> })
        .exists(layoutPath);

      logger.debug("[LayoutCollector] Checking API layout", {
        layoutPath,
        exists: layoutExists,
      });

      if (layoutExists) {
        nestedLayouts.push({
          kind: "tsx",
          component: undefined,
          componentPath: layoutPath,
          path: layoutPath,
        });

        logger.debug("[LayoutCollector] Added API layout to nestedLayouts", {
          layoutPath,
        });
      }
    } else if (projectData?.layout) {
      logger.debug("[LayoutCollector] Skipping invalid layout value (not a file path)", {
        layout: projectData.layout,
      });
    }

    // Also try to auto-discover layout.tsx in components folder
    // This provides a fallback when layout is not explicitly configured
    if (nestedLayouts.length === 0) {
      const defaultLayoutPath = join(this.projectDir, "components", "layout.tsx");
      const defaultLayoutExists = await (wrappedAdapter as { exists: (path: string) => Promise<boolean> })
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
