import type { ComponentProps } from "@veryfront/types";
import type { HTMLGenerationOptions } from "../types.ts";
import type { HydrationDataStructure } from "./types.ts";

/**
 * Convert absolute server paths to project-relative paths for client hydration.
 * E.g., /Users/.../veryfront-private/components/layouts/DefaultLayout.mdx -> layouts/DefaultLayout.mdx
 *       /Users/.../veryfront-private/pages/index.mdx -> pages/index.mdx
 */
function toProjectRelativePath(absolutePath: string, projectDir?: string): string {
  if (!absolutePath) return "";

  let relativePath = absolutePath.replace(/\\/g, "/");

  // Strip project directory prefix (must happen before removing leading slash)
  if (projectDir) {
    const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");
    if (relativePath.startsWith(normalizedProjectDir + "/")) {
      relativePath = relativePath.substring(normalizedProjectDir.length + 1);
    } else if (relativePath.startsWith(normalizedProjectDir)) {
      relativePath = relativePath.substring(normalizedProjectDir.length);
    }
  }

  // Remove leading slash (after project dir stripping)
  relativePath = relativePath.replace(/^\//, "");

  // Remove components/ prefix if present (veryfront projects store layouts in components/)
  if (relativePath.startsWith("components/")) {
    relativePath = relativePath.substring("components/".length);
  }

  return relativePath;
}

function inferPageType(pagePath?: string): "mdx" | "tsx" | "jsx" | "ts" | "js" | undefined {
  if (!pagePath) return undefined;
  const ext = pagePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mdx":
      return "mdx";
    case "tsx":
      return "tsx";
    case "jsx":
      return "jsx";
    case "ts":
      return "ts";
    case "js":
      return "js";
    default:
      return undefined;
  }
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
  };

  return JSON.stringify(data, null, 2);
}
