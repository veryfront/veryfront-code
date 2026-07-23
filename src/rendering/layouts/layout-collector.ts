import { isAbsolute, join, normalize, relative } from "#veryfront/compat/path";
import { rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { EntityInfo, LayoutItem, MdxBundle } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { getLayoutEntity } from "#veryfront/types/entities/getEntityInfo.ts";
import { discoverNestedLayouts } from "./utils/discovery.ts";
import { detectAppRouter } from "../router-detection.ts";
import { LAYOUT_EXTENSIONS, type LayoutExtension } from "./types.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CONFIG_INVALID, LAYOUT_NOT_FOUND } from "#veryfront/errors";

const logger = rendererLogger.component("layout-collector");

export function resolveLayoutRouterRootDir(
  projectDir: string,
  useAppRouter: boolean,
  config: VeryfrontConfig,
): string {
  const directory = useAppRouter
    ? config.directories?.app ?? "app"
    : config.directories?.pages ?? "pages";
  if (!isSafeRouterDirectory(directory)) {
    throw CONFIG_INVALID.create({
      detail: "Router directories must stay inside the project",
    });
  }
  return join(projectDir, directory);
}

function isSafeRouterDirectory(path: string): boolean {
  return path !== "" && !path.includes("\0") && !path.includes("\\") &&
    !isAbsolute(path) && path.split("/").every((segment) => segment !== "" && segment !== "..");
}

function isPathWithinRoot(path: string, root: string): boolean {
  const relativePath = relative(normalize(root), normalize(path));
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}

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
interface ComponentsLayoutDiscoveryResult {
  layoutPath: string;
  extension: LayoutExtension;
}

export interface LayoutCollectionResult {
  layoutBundle: MdxBundle | undefined;
  nestedLayouts: LayoutItem[];
}

export interface LayoutCollectorOptions {
  projectDir: string;
  projectId?: string;
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
  private projectId?: string;
  private adapter: RuntimeAdapter;
  private config: VeryfrontConfig;
  private compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>;

  constructor(options: LayoutCollectorOptions) {
    this.projectDir = options.projectDir;
    this.projectId = options.projectId;
    this.adapter = options.adapter;
    this.config = options.config;
    this.compileMDX = options.compileMDX;
  }

  async collectLayouts(pageInfo: EntityInfo): Promise<LayoutCollectionResult> {
    return withSpan(
      SpanNames.LAYOUT_COLLECT,
      async () => {
        const pagePath = pageInfo.entity.path;

        logger.debug("collectLayouts called", {
          hasConfig: !!this.config,
          hasConfiguredLayout: typeof this.config?.layout === "string",
        });

        if (pagePath.includes("/.veryfront/") || pagePath.includes(".veryfront/")) {
          logger.debug("Skipping layouts for internal path");
          return { layoutBundle: undefined, nestedLayouts: [] };
        }

        const layoutValue = pageInfo.entity.frontmatter.layout as string | boolean | undefined;
        if (layoutValue === false || layoutValue === "false") {
          logger.debug("Layout explicitly disabled via frontmatter");
          return { layoutBundle: undefined, nestedLayouts: [] };
        }

        const hasExplicitFrontmatterLayout = typeof layoutValue === "string" &&
          layoutValue.length > 0;

        const { layoutBundle, layoutPath } = await withSpan(
          SpanNames.LAYOUT_COLLECT_NAMED,
          () => this.collectNamedLayoutWithPath(pageInfo),
          { "layout.has_config_layout": typeof this.config?.layout === "string" },
        );

        return this.processLayoutResult(
          pageInfo,
          hasExplicitFrontmatterLayout,
          layoutBundle,
          layoutPath,
        );
      },
      undefined,
    );
  }

  private async processLayoutResult(
    pageInfo: EntityInfo,
    hasExplicitFrontmatterLayout: boolean,
    layoutBundle: MdxBundle | undefined,
    layoutPath: string | undefined,
  ): Promise<LayoutCollectionResult> {
    if (hasExplicitFrontmatterLayout && layoutPath) {
      logger.debug("Using frontmatter layout as nested layout", {
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
      undefined,
    );

    // If no layout path is set, return without adding config layout
    // Note: layoutBundle can be undefined for TSX layouts (they don't need MDX compilation)
    // but layoutPath will still be set if a config.layout was specified
    if (!layoutPath) {
      logger.debug("collectLayouts result - no layout path", {
        hasLayoutBundle: !!layoutBundle,
        hasExplicitFrontmatterLayout,
        nestedLayoutsCount: nestedLayouts.length,
      });

      return { layoutBundle, nestedLayouts };
    }

    if (nestedLayouts.some((l) => l.path === layoutPath)) {
      logger.debug("Skipping configured layout because it is already nested");
      return { layoutBundle: undefined, nestedLayouts };
    }

    nestedLayouts = [createLayoutItem(layoutPath, layoutBundle), ...nestedLayouts];

    logger.debug("Added config.layout to nestedLayouts for client hydration", {
      kind: getLayoutKind(layoutPath),
      totalNestedLayouts: nestedLayouts.length,
    });

    return { layoutBundle: undefined, nestedLayouts };
  }

  private async collectNamedLayoutWithPath(pageInfo: EntityInfo): Promise<{
    layoutBundle: MdxBundle | undefined;
    layoutPath: string | undefined;
  }> {
    const layoutValue = pageInfo.entity.frontmatter.layout as string | boolean | undefined;

    logger.debug("collectNamedLayoutWithPath called", {
      hasFrontmatterLayout: typeof layoutValue === "string" && layoutValue.length > 0,
      hasConfiguredLayout: typeof this.config?.layout === "string",
    });

    const layoutName = this.resolveLayoutName(layoutValue);

    if (!layoutName) {
      return { layoutBundle: undefined, layoutPath: undefined };
    }

    const layoutInfo = await withSpan(
      SpanNames.LAYOUT_GET_ENTITY,
      () => getLayoutEntity(this.projectDir, layoutName, this.adapter),
      undefined,
    );

    logger.debug("Layout entity lookup completed", { found: !!layoutInfo });

    if (!layoutInfo) {
      const source = typeof layoutValue === "string" ? "frontmatter" : "config";
      throw LAYOUT_NOT_FOUND.create({
        detail:
          `Layout "${layoutName}" was not found. It is specified in ${source}. Check that the layout file exists.`,
      });
    }

    const layoutPath = layoutInfo.entity.path;
    const kind = getLayoutKind(layoutPath);

    logger.debug("Processing named layout", {
      kind,
      contentLength: layoutInfo.entity.content.length,
    });

    if (kind === "tsx") {
      logger.debug("Named layout is TSX, skipping MDX compilation");
      return { layoutBundle: undefined, layoutPath };
    }

    const layoutBundle = await this.compileMDX(
      layoutInfo.entity.content,
      { ...layoutInfo.entity.frontmatter, isLayout: true },
      layoutPath,
    );

    logger.debug("Named Layout MDX compiled", {
      codeLength: layoutBundle.compiledCode?.length,
    });

    return { layoutBundle, layoutPath };
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
    const useAppRouter = await detectAppRouter(this.projectDir, this.config, this.adapter, {
      projectId: this.projectId,
    });

    // Unified path for ALL adapters - discoverNestedLayouts uses adapter.fs.stat()
    // which works for both filesystem and API adapters
    return this.collectLayoutsUnified(pageFilePath, useAppRouter);
  }

  private async collectLayoutsUnified(
    pageFilePath: string,
    useAppRouter: boolean,
  ): Promise<LayoutItem[]> {
    const rootDir = resolveLayoutRouterRootDir(
      this.projectDir,
      useAppRouter,
      this.config,
    );

    logger.debug("collectLayoutsUnified", {
      useAppRouter,
    });

    const nestedLayouts = await discoverNestedLayouts(
      pageFilePath,
      rootDir,
      this.projectDir,
      this.adapter,
      this.projectId ?? this.projectDir,
    );

    if (nestedLayouts.length > 0) {
      logger.debug("Found nested layouts", {
        count: nestedLayouts.length,
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
      );
      return [];
    }

    const checker: FileExistenceChecker = {
      exists: async (path: string) => {
        if (!isPathWithinRoot(path, this.projectDir)) {
          throw CONFIG_INVALID.create({
            detail: "Components layout path must stay inside the project",
          });
        }

        try {
          const stat = this.adapter.fs.lstat
            ? await this.adapter.fs.lstat(path)
            : await this.adapter.fs.stat(path);
          if (stat.isSymlink) {
            throw CONFIG_INVALID.create({
              detail: "Components layout must be a regular file, not a symbolic link",
            });
          }
          if (!stat.isFile) return false;

          if (this.adapter.fs.realPath) {
            const [canonicalPath, canonicalRoot] = await Promise.all([
              this.adapter.fs.realPath(path),
              this.adapter.fs.realPath(this.projectDir),
            ]);
            if (!isPathWithinRoot(canonicalPath, canonicalRoot)) {
              throw CONFIG_INVALID.create({
                detail: "Components layout path must stay inside the project",
              });
            }
          }

          return true;
        } catch (error) {
          if (isNotFoundError(error)) return false;
          throw error;
        }
      },
    };

    const layoutPath = await discoverComponentsLayoutPath(this.projectDir, checker);
    if (!layoutPath) {
      return [];
    }

    logger.debug("Added fallback components layout");
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
