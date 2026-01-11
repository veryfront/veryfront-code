import type { ComponentProps } from "@veryfront/types";
import type { HTMLGenerationOptions } from "../types.ts";
import type { HydrationDataStructure } from "./types.ts";
import { resolveRelativePath } from "@veryfront/modules/react-loader/path-resolver.ts";

function toProjectRelativePath(absolutePath: string, projectDir?: string): string {
  if (!absolutePath) return "";
  if (!projectDir) {
    return absolutePath.replace(/\\/g, "/").replace(/^\//, "");
  }
  return resolveRelativePath(absolutePath.replace(/\\/g, "/"), projectDir);
}

const PAGE_TYPE_EXTENSIONS = new Set(["mdx", "tsx", "jsx", "ts", "js"] as const);
type PageType = "mdx" | "tsx" | "jsx" | "ts" | "js";

function inferPageType(pagePath?: string): PageType | undefined {
  if (!pagePath) return undefined;
  const ext = pagePath.split(".").pop()?.toLowerCase();
  return ext && PAGE_TYPE_EXTENSIONS.has(ext as PageType) ? (ext as PageType) : undefined;
}

export function generateHydrationData(
  slug: string,
  params: Record<string, string | string[]>,
  props: ComponentProps,
  options: HTMLGenerationOptions,
): string {
  const layouts = (options.nestedLayouts || [])
    .map((l) => ({
      kind: l.kind as "mdx" | "tsx",
      path: toProjectRelativePath(l.path || l.componentPath || "", options.projectDir),
    }))
    .filter((l) => l.path !== "");

  const data: HydrationDataStructure = {
    slug: slug || "",
    props: props || {},
    params: params || {},
    layouts,
    providers: (options.providerPaths || []).map((p) =>
      toProjectRelativePath(p, options.projectDir)
    ),
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
  };

  return JSON.stringify(data, null, 2);
}
