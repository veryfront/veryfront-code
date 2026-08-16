import { isAbsolute, join, normalize } from "#veryfront/compat/path";
import { rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo, LayoutItem, MdxBundle } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import { getLayoutEntity } from "#veryfront/types/entities/getEntityInfo.ts";
import { discoverNestedLayouts } from "./utils/discovery.ts";
import { resolveRouterModeForPage } from "../router-detection.ts";
import { LAYOUT_EXTENSIONS, type LayoutExtension } from "./types.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { LAYOUT_NOT_FOUND } from "#veryfront/errors";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { ensureDefaultParserContracts } from "#veryfront/extensions/parser/defaults.ts";
import type { ASTNode, CodeParser } from "#veryfront/extensions/parser/index.ts";

const logger = rendererLogger.component("layout-collector");

export function resolveLayoutRouterRootDir(
  projectDir: string,
  useAppRouter: boolean,
  config: VeryfrontConfig,
): string {
  const directory = useAppRouter
    ? config.directories?.app ?? "app"
    : config.directories?.pages ?? "pages";
  return join(projectDir, directory);
}

function resolvePagePath(pageFilePath: string, projectDir: string): string {
  return normalize(
    isAbsolute(pageFilePath) ? pageFilePath : join(projectDir, pageFilePath),
  );
}

function getLayoutKind(path: string): "mdx" | "tsx" {
  return path.endsWith(".mdx") || path.endsWith(".md") ? "mdx" : "tsx";
}

function isAstNode(value: unknown): value is ASTNode {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

function getProgramBody(ast: ASTNode): ASTNode[] {
  const program = isAstNode(ast.program) ? ast.program : ast;
  return Array.isArray(program.body) ? program.body.filter(isAstNode) : [];
}

function getIdentifierName(node: unknown): string | undefined {
  if (!isAstNode(node) || node.type !== "Identifier") return undefined;
  return typeof node.name === "string" ? node.name : undefined;
}

function unwrapTsExpression(node: ASTNode): ASTNode {
  let current = node;
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TypeCastExpression" ||
    current.type === "ParenthesizedExpression"
  ) {
    if (!isAstNode(current.expression)) break;
    current = current.expression;
  }
  return current;
}

function getLiteralLayoutValue(node: unknown): boolean | string | undefined {
  if (!isAstNode(node)) return undefined;
  const literal = unwrapTsExpression(node);
  if (
    literal.type !== "BooleanLiteral" && literal.type !== "StringLiteral" &&
    literal.type !== "Literal"
  ) {
    return undefined;
  }
  return typeof literal.value === "boolean" || typeof literal.value === "string"
    ? literal.value
    : undefined;
}

function getObjectLayoutValue(node: unknown): boolean | string | undefined {
  if (!isAstNode(node)) return undefined;
  const object = unwrapTsExpression(node);
  if (object.type !== "ObjectExpression" || !Array.isArray(object.properties)) return undefined;

  for (const property of object.properties) {
    if (
      !isAstNode(property) || (property.type !== "ObjectProperty" && property.type !== "Property")
    ) {
      continue;
    }
    const key = getIdentifierName(property.key) ??
      (isAstNode(property.key) && typeof property.key.value === "string"
        ? property.key.value
        : undefined);
    if (key !== "layout") continue;
    return getLiteralLayoutValue(property.value);
  }

  return undefined;
}

async function extractTsxLayoutSignal(
  source: string,
  filePath: string,
): Promise<boolean | string | undefined> {
  await ensureDefaultParserContracts();
  const parser = tryResolve<CodeParser>("CodeParser");
  if (!parser) return undefined;

  let ast: ASTNode;
  try {
    ast = await parser.parse({ code: source, filePath });
  } catch {
    return undefined;
  }

  let directLayout: boolean | string | undefined;
  let frontmatterLayout: boolean | string | undefined;
  for (const statement of getProgramBody(ast)) {
    if (statement.type !== "ExportNamedDeclaration" || !isAstNode(statement.declaration)) {
      continue;
    }
    const declaration = statement.declaration;
    if (
      declaration.type !== "VariableDeclaration" || declaration.kind !== "const" ||
      !Array.isArray(declaration.declarations)
    ) {
      continue;
    }

    for (const declarator of declaration.declarations) {
      if (!isAstNode(declarator) || declarator.type !== "VariableDeclarator") continue;
      const name = getIdentifierName(declarator.id);
      if (name === "frontmatter" && frontmatterLayout === undefined) {
        frontmatterLayout = getObjectLayoutValue(declarator.init);
      } else if (name === "layout" && directLayout === undefined) {
        directLayout = getLiteralLayoutValue(declarator.init);
      }
    }
  }

  return frontmatterLayout ?? directLayout;
}

/**
 * Merges the per-page layout signal of a tsx/jsx/ts/js page into its
 * frontmatter. Md/mdx pages carry the signal in their YAML frontmatter, which
 * is already parsed onto the entity. Tsx pages cannot start with a YAML block,
 * so their signal is read from top-level module exports instead:
 * `export const layout = false | "Name"` or
 * `export const frontmatter = { layout: … }`.
 */
async function withModuleLayoutSignal(pageInfo: EntityInfo): Promise<EntityInfo> {
  if (pageInfo.entity.frontmatter.layout !== undefined) return pageInfo;
  if (getLayoutKind(pageInfo.entity.path) !== "tsx") return pageInfo;

  const source = pageInfo.entity.content;
  if (!source || !source.includes("layout")) return pageInfo;

  const layout = await extractTsxLayoutSignal(source, pageInfo.entity.path);
  if (layout === undefined) return pageInfo;

  return {
    ...pageInfo,
    entity: {
      ...pageInfo.entity,
      frontmatter: { ...pageInfo.entity.frontmatter, layout },
    },
  };
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
          pagePath,
          projectDir: this.projectDir,
          hasConfig: !!this.config,
          layout: this.config?.layout,
        });

        if (pagePath.includes("/.veryfront/") || pagePath.includes(".veryfront/")) {
          logger.debug("Skipping layouts for .veryfront path", { pagePath });
          return { layoutBundle: undefined, nestedLayouts: [] };
        }

        const resolvedPageInfo = await withModuleLayoutSignal(pageInfo);
        const layoutValue = resolvedPageInfo.entity.frontmatter.layout as
          | string
          | boolean
          | undefined;
        if (layoutValue === false || layoutValue === "false") {
          logger.debug("Layout explicitly disabled via frontmatter", {
            pagePath,
            layoutValue,
          });
          return { layoutBundle: undefined, nestedLayouts: [] };
        }

        const hasExplicitFrontmatterLayout = typeof layoutValue === "string" &&
          layoutValue.length > 0;

        const { layoutBundle, layoutPath, layoutName } = await withSpan(
          SpanNames.LAYOUT_COLLECT_NAMED,
          () => this.collectNamedLayoutWithPath(resolvedPageInfo),
          {
            "layout.page_path": pagePath,
            "layout.config_layout": this.config?.layout || "none",
          },
        );

        return this.processLayoutResult(
          resolvedPageInfo,
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
      logger.debug("Using frontmatter layout as nestedLayout", {
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
      logger.debug("collectLayouts result - no layout path", {
        hasLayoutBundle: !!layoutBundle,
        hasExplicitFrontmatterLayout,
        nestedLayoutsCount: nestedLayouts.length,
      });

      return { layoutBundle, nestedLayouts };
    }

    if (nestedLayouts.some((l) => l.path === layoutPath)) {
      logger.debug("Skipping config.layout - already in nestedLayouts", {
        layoutPath,
      });
      return { layoutBundle: undefined, nestedLayouts };
    }

    nestedLayouts = [createLayoutItem(layoutPath, layoutBundle), ...nestedLayouts];

    logger.debug("Added config.layout to nestedLayouts for client hydration", {
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

    logger.debug("collectNamedLayoutWithPath called", {
      pagePath: pageInfo.entity.path,
      layoutValue,
      frontmatterKeys: Object.keys(pageInfo.entity.frontmatter),
      configLayout: this.config?.layout,
    });

    const layoutName = this.resolveLayoutName(layoutValue);

    logger.debug("Resolved layoutName:", { layoutName });

    if (!layoutName) {
      return { layoutBundle: undefined, layoutPath: undefined, layoutName: undefined };
    }

    const layoutInfo = await withSpan(
      SpanNames.LAYOUT_GET_ENTITY,
      () => getLayoutEntity(this.projectDir, layoutName, this.adapter),
      { "layout.name": layoutName, "layout.project_dir": this.projectDir },
    );

    logger.debug("Layout entity found:", { found: !!layoutInfo, layoutName });

    if (!layoutInfo) {
      const source = typeof layoutValue === "string" ? "frontmatter" : "config";
      throw LAYOUT_NOT_FOUND.create({
        detail:
          `Layout "${layoutName}" not found. Specified in ${source} for page "${pageInfo.entity.path}". Check that the layout file exists.`,
      });
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
    const pageFilePath = resolvePagePath(pageInfo.entity.path, this.projectDir);
    const routerMode = resolveRouterModeForPage(
      this.projectDir,
      pageInfo.entity.path,
      this.config,
    );
    const rootDir = resolveLayoutRouterRootDir(
      this.projectDir,
      routerMode === "app",
      this.config,
    );

    return this.collectLayoutsUnified(pageFilePath, rootDir);
  }

  private async collectLayoutsUnified(
    pageFilePath: string,
    rootDir: string,
  ): Promise<LayoutItem[]> {
    logger.debug("collectLayoutsUnified", {
      pageFilePath,
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
      logger.debug("Found nested layouts", {
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
        } catch (_) {
          /* expected: file may not exist */
          return false;
        }
      },
    };

    const layoutPath = await discoverComponentsLayoutPath(this.projectDir, checker);
    if (!layoutPath) {
      return [];
    }

    logger.debug("Added fallback components layout", { layoutPath });
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
