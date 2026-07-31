import type { ComponentProps } from "#veryfront/types";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { buildReleaseAssetModules } from "#veryfront/release-assets/client-module-map.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { createBuildVersion } from "#veryfront/utils/version.ts";
import type { HTMLGenerationOptions } from "../types.ts";
import type { HydrationDataStructure } from "./types.ts";
import { snapshotHTMLJsonRecord, snapshotHTMLJsonValue } from "../json-snapshot.ts";
import { resolveCanonicalProjectRelativePath } from "../project-relative-path.ts";
import { snapshotHTMLHydrationConfig } from "../html-config-snapshot.ts";

type HydrationPageType = NonNullable<HydrationDataStructure["pageType"]>;
const NON_JSON_HYDRATION_OPTION_KEYS = new Set(["projectClasses"]);
const HYDRATION_OPTION_VALUE_PROJECTORS = {
  config: snapshotHTMLHydrationConfig,
};

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
  params = snapshotHTMLJsonValue(params, "Hydration route params");
  props = snapshotHTMLJsonValue(props, "Hydration component props");
  options = snapshotHTMLJsonRecord(options, "Hydration options", {
    omitKeys: NON_JSON_HYDRATION_OPTION_KEYS,
    projectValues: HYDRATION_OPTION_VALUE_PROJECTORS,
  }) as HydrationOptions;
  serializeOptions = serializeOptions === undefined
    ? undefined
    : snapshotHTMLJsonRecord(serializeOptions, "Hydration serialization options");

  const layouts = (options.nestedLayouts ?? [])
    .map((layout) => {
      const path = resolveCanonicalProjectRelativePath(
        layout.path ?? layout.componentPath ?? "",
        options.projectDir,
        { module: true },
      );

      if (!path) return null;

      return {
        kind: layout.kind as "mdx" | "tsx",
        path,
      };
    })
    .filter((layout): layout is NonNullable<typeof layout> => Boolean(layout));
  const appPath = options.appPath
    ? resolveCanonicalProjectRelativePath(
      options.appPath,
      options.projectDir,
      { module: true },
    )
    : undefined;
  const errorPath = options.errorPath
    ? resolveCanonicalProjectRelativePath(
      options.errorPath,
      options.projectDir,
      { module: true },
    )
    : undefined;
  const pagePath = options.pagePath
    ? resolveCanonicalProjectRelativePath(
      options.pagePath,
      options.projectDir,
      { module: true },
    )
    : undefined;
  const hydrationModulePaths = [
    pagePath,
    ...layouts.map((layout) => layout.path),
    appPath,
    errorPath,
  ].filter((path): path is string => Boolean(path));
  const buildVersion = snapshotHTMLJsonRecord(
    createBuildVersion(),
    "Hydration build version",
  );

  const data: HydrationDataStructure = {
    slug: slug || "",
    props: props || {},
    params: params || {},
    layouts,
    appPath,
    errorPath,
    appRouterRoot: resolveCanonicalProjectRelativePath(
      options.config?.directories?.app ?? "app",
      options.projectDir,
    ),
    isolatedClientPage: options.isolatedClientPage,
    pagePath,
    // `options.pageType`/`options.environment` are validated against literal
    // enum schemas (see html.schema.ts), but the schema inference widens them
    // to `string`. Narrow back to the real literal unions rather than `any`.
    pageType: (options.pageType as HydrationPageType | undefined) ||
      inferPageType(pagePath),
    clientModuleStrategy: options.clientModuleStrategy === "fs" ? "fs" : "rsc-module",
    ...(options.dependencyPinningCacheKey &&
        options.dependencyPinningCacheKey !== "off"
      ? { dependencyPinningCacheKey: options.dependencyPinningCacheKey }
      : {}),
    releaseId: options.releaseId,
    releaseAssetModules: buildReleaseAssetModules(
      options.releaseAssetManifest,
      { logicalPaths: hydrationModulePaths },
    ),
    buildVersion,
    frontmatter: options.frontmatter,
    layoutProps: options.layoutProps
      ? Object.fromEntries(
        Object.entries(options.layoutProps).flatMap(([path, layoutProps]) => {
          const canonicalPath = resolveCanonicalProjectRelativePath(
            path,
            options.projectDir,
            { module: true },
          );
          return canonicalPath ? [[canonicalPath, layoutProps]] : [];
        }),
      )
      : undefined,
    // In dev mode, client uses createRoot instead of hydrateRoot to avoid
    // hydration mismatches from compilation differences between SSR and client
    dev: options.mode === "development",
    headings: options.headings,
    studioEmbed: options.studioEmbed,
  };

  const pretty = serializeOptions?.pretty ?? true;
  const snapshot = snapshotHTMLJsonRecord(data, "Hydration data");
  return jsonForInlineScript(snapshot, pretty ? 2 : undefined);
}
