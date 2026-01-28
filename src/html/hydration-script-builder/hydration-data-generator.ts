import type { ComponentProps } from "#veryfront/types";
import { resolveRelativePath } from "#veryfront/modules/react-loader/path-resolver.ts";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import type { HTMLGenerationOptions } from "../types.ts";
import type { HydrationDataStructure } from "./types.ts";

function toProjectRelativePath(absolutePath: string, projectDir?: string): string {
  if (!absolutePath) return "";

  const normalizedPath = absolutePath.replace(/\\/g, "/");

  if (!projectDir) return normalizedPath.replace(/^\//, "");

  return resolveRelativePath(normalizedPath, projectDir);
}

const PAGE_TYPE_EXTENSIONS = new Set(["mdx", "tsx", "jsx", "ts", "js"] as const);
type PageType = "mdx" | "tsx" | "jsx" | "ts" | "js";

function inferPageType(pagePath?: string): PageType | undefined {
  if (!pagePath) return undefined;
  const ext = getExtensionName(pagePath);
  if (!ext) return undefined;

  return PAGE_TYPE_EXTENSIONS.has(ext as PageType) ? (ext as PageType) : undefined;
}

export function generateHydrationData(
  slug: string,
  params: Record<string, string | string[]>,
  props: ComponentProps,
  options: HTMLGenerationOptions,
): string {
  const layouts = (options.nestedLayouts ?? [])
    .map((layout) => ({
      kind: layout.kind as "mdx" | "tsx",
      path: toProjectRelativePath(layout.path ?? layout.componentPath ?? "", options.projectDir),
    }))
    .filter((layout) => layout.path);

  const data: HydrationDataStructure = {
    slug: slug || "",
    props: props || {},
    params: params || {},
    layouts,
    appPath: options.appPath
      ? toProjectRelativePath(options.appPath, options.projectDir)
      : undefined,
    pagePath: options.pagePath
      ? toProjectRelativePath(options.pagePath, options.projectDir)
      : undefined,
    pageType: options.pageType || inferPageType(options.pagePath),
    frontmatter: options.frontmatter,
    layoutProps: options.layoutProps,
    // In dev mode, client uses createRoot instead of hydrateRoot to avoid
    // hydration mismatches from compilation differences between SSR and client
    dev: options.mode === "development",
    headings: options.headings,
    studioEmbed: options.studioEmbed,
  };

  return JSON.stringify(data, null, 2);
}
