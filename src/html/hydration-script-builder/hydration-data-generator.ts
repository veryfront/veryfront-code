import type { ComponentProps } from "#veryfront/types";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import { determineClientModuleStrategy } from "#veryfront/rendering/rsc/client-module-strategy.ts";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { buildReleaseAssetModules } from "#veryfront/release-assets/client-module-map.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import type { HTMLGenerationOptions } from "../types.ts";
import type { HydrationDataStructure } from "./types.ts";

type HydrationPageType = NonNullable<HydrationDataStructure["pageType"]>;
type HydrationEnvironment = NonNullable<
  Parameters<typeof determineClientModuleStrategy>[0]["environment"]
>;

function toProjectRelativePath(absolutePath: string, projectDir?: string): string {
  if (!absolutePath) return "";

  const normalizedPath = absolutePath.replace(/\\/g, "/");

  if (!projectDir) return normalizedPath.replace(/^\//, "");

  if (!normalizedPath.startsWith("/") && !/^[A-Za-z]:\//.test(normalizedPath)) {
    const relativePath = normalizedPath.replace(/^\.\//, "");
    return relativePath === ".." || relativePath.startsWith("../") ? "" : relativePath;
  }

  const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const projectPrefix = normalizedProjectDir.endsWith("/")
    ? normalizedProjectDir
    : `${normalizedProjectDir}/`;

  if (!normalizedPath.startsWith(projectPrefix)) return "";
  return normalizedPath.slice(projectPrefix.length);
}

const PAGE_TYPE_EXTENSIONS = new Set(["mdx", "tsx", "jsx", "ts", "js"] as const);
type PageType = "mdx" | "tsx" | "jsx" | "ts" | "js";

function inferPageType(pagePath?: string): PageType | undefined {
  if (!pagePath) return undefined;

  const ext = getExtensionName(pagePath);
  if (!ext) return undefined;

  return PAGE_TYPE_EXTENSIONS.has(ext as PageType) ? (ext as PageType) : undefined;
}

type HydrationOptions = HTMLGenerationOptions & {
  releaseAssetManifest?: ReleaseAssetManifest | null;
};

export function generateHydrationData(
  slug: string,
  params: Record<string, string | string[]>,
  props: ComponentProps,
  options: HydrationOptions,
  serializeOptions?: { pretty?: boolean },
): string {
  const layouts = (options.nestedLayouts ?? [])
    .map((layout) => {
      const path = toProjectRelativePath(
        layout.path ?? layout.componentPath ?? "",
        options.projectDir,
      );

      if (!path) return null;

      return {
        kind: layout.kind as "mdx" | "tsx",
        path,
      };
    })
    .filter((layout): layout is NonNullable<typeof layout> => Boolean(layout));

  const data: HydrationDataStructure = {
    slug: slug || "",
    props: props || {},
    params: params || {},
    layouts,
    appPath: options.appPath
      ? toProjectRelativePath(options.appPath, options.projectDir) || undefined
      : undefined,
    appRouterRoot: toProjectRelativePath(
      options.config?.directories?.app ?? "app",
      options.projectDir,
    ).replace(/^\/+|\/+$/g, ""),
    isolatedClientPage: options.isolatedClientPage,
    pagePath: options.pagePath
      ? toProjectRelativePath(options.pagePath, options.projectDir) || undefined
      : undefined,
    // `options.pageType`/`options.environment` are validated against literal
    // enum schemas (see html.schema.ts), but the schema inference widens them
    // to `string`. Narrow back to the real literal unions rather than `any`.
    pageType: (options.pageType as HydrationPageType | undefined) ||
      inferPageType(options.pagePath),
    clientModuleStrategy: determineClientModuleStrategy({
      isLocalProject: options.isLocalProject,
      environment: options.environment as HydrationEnvironment | undefined,
    }),
    releaseId: options.releaseId,
    releaseAssetModules: buildReleaseAssetModules(options.releaseAssetManifest),
    frontmatter: options.frontmatter,
    layoutProps: options.layoutProps,
    // In dev mode, client uses createRoot instead of hydrateRoot to avoid
    // hydration mismatches from compilation differences between SSR and client
    dev: options.mode === "development",
    headings: options.headings,
    studioEmbed: options.studioEmbed,
  };

  const pretty = serializeOptions?.pretty ?? true;
  return jsonForInlineScript(data, pretty ? 2 : undefined);
}
