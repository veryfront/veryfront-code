import type { ComponentProps } from "#veryfront/types";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import { determineClientModuleStrategy } from "#veryfront/rendering/rsc/client-module-strategy.ts";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { resolveRelativePath } from "#veryfront/modules/react-loader/path-resolver.ts";
import type { HTMLRuntimeGenerationOptions } from "../types.ts";
import {
  getUTF8ByteLength,
  MAX_HTML_HEADINGS,
  MAX_HTML_HYDRATION_DATA_BYTES,
  MAX_HTML_NESTED_LAYOUTS,
  MAX_HTML_PATH_BYTES,
  MAX_HTML_RELEASE_ID_BYTES,
  MAX_HTML_SLUG_BYTES,
} from "../limits.ts";
import {
  decodePathSegmentFully,
  hasPathControlCharacter,
  isSafeModulePathSegment,
} from "../path-safety.ts";
import { snapshotHydrationParams } from "../hydration-params.ts";
import type { HydrationDataStructure } from "./types.ts";
import { hasUnpairedUtf16Surrogate, hasUnsafeUnicodeFormatting } from "../unicode-safety.ts";
import { createHydrationJSONSnapshotter, snapshotPlainDataRecord } from "../json-snapshot.ts";

type HydrationPageType = NonNullable<HydrationDataStructure["pageType"]>;
type HydrationEnvironment = NonNullable<
  Parameters<typeof determineClientModuleStrategy>[0]["environment"]
>;
const MAX_RELEASE_ASSET_MODULES = 10_000;
const MAX_HYDRATION_OBJECT_ENTRIES = 10_000;
const MAX_RELEASE_MANIFEST_FIELDS = 256;
const MAX_RELEASE_ASSET_MODULE_ENTRY_FIELDS = 32;
const RELEASE_ASSET_MODULE_URL_PATTERN = /^\/_vf\/assets\/[0-9a-f]{64}\.js$/;

function exceedsUTF8Limit(value: string, maxBytes: number): boolean {
  return value.length > maxBytes || getUTF8ByteLength(value) > maxBytes;
}

function isSafeHydrationModulePathSegment(segment: string): boolean {
  if (!isSafeModulePathSegment(segment)) return false;
  try {
    const decoded = decodePathSegmentFully(segment);
    return !hasUnpairedUtf16Surrogate(decoded) && !hasUnsafeUnicodeFormatting(decoded);
  } catch {
    return false;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertBoundedPlainRecord(
  value: unknown,
  label: string,
  maxEntries = MAX_HYDRATION_OBJECT_ENTRIES,
): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be an object`);
  if (Object.keys(value).length > maxEntries) {
    throw new TypeError(`${label} exceed the entry limit`);
  }
}

function assertValidHydrationHeadings(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > MAX_HTML_HEADINGS) {
    throw new TypeError("Hydration headings exceed the entry limit");
  }
  for (const heading of value) {
    if (
      !isPlainRecord(heading) || typeof heading.id !== "string" ||
      typeof heading.text !== "string" || exceedsUTF8Limit(heading.id, MAX_HTML_PATH_BYTES) ||
      exceedsUTF8Limit(heading.text, MAX_HTML_PATH_BYTES) ||
      !Number.isSafeInteger(heading.level) || (heading.level as number) <= 0 ||
      (heading.level as number) > 6
    ) {
      throw new TypeError("Hydration headings contain an invalid entry");
    }
  }
}

function toProjectRelativePath(
  absolutePath: unknown,
  projectDir: string | undefined,
  label: string,
): string {
  if (typeof absolutePath !== "string" || absolutePath.length === 0) {
    throw new TypeError(`Hydration ${label} is invalid`);
  }
  const normalizedPath = absolutePath.replace(/\\/g, "/");
  if (
    exceedsUTF8Limit(normalizedPath, MAX_HTML_PATH_BYTES) || /[?#<>"']/.test(normalizedPath) ||
    hasPathControlCharacter(normalizedPath) || hasUnpairedUtf16Surrogate(normalizedPath) ||
    normalizedPath
      .split("/")
      .slice(normalizedPath.startsWith("/") ? 1 : 0)
      .some((segment) => !isSafeHydrationModulePathSegment(segment))
  ) throw new TypeError(`Hydration ${label} is invalid`);
  if (projectDir !== undefined && typeof projectDir !== "string") {
    throw new TypeError("Hydration project directory is invalid");
  }
  const normalizedProjectDir = projectDir?.replace(/\\/g, "/") ?? ".";
  try {
    const relativePath = resolveRelativePath(normalizedPath, normalizedProjectDir).replace(
      /\\/g,
      "/",
    );
    if (
      !relativePath ||
      relativePath.split("/").some((segment) => !isSafeHydrationModulePathSegment(segment))
    ) {
      throw new TypeError(`Hydration ${label} is invalid`);
    }
    return relativePath;
  } catch {
    throw new TypeError(`Hydration ${label} is invalid`);
  }
}

const PAGE_TYPE_EXTENSIONS = new Set(["mdx", "md", "tsx", "jsx", "ts", "js"] as const);
type PageType = "mdx" | "md" | "tsx" | "jsx" | "ts" | "js";

function inferPageType(pagePath?: string): PageType | undefined {
  if (!pagePath) return undefined;

  const ext = getExtensionName(pagePath);
  if (!ext) return undefined;

  return PAGE_TYPE_EXTENSIONS.has(ext as PageType) ? (ext as PageType) : undefined;
}

function buildSafeReleaseAssetModules(
  manifest?: ReleaseAssetManifest | null,
): Record<string, string> | undefined {
  if (!manifest) return undefined;
  const manifestSnapshot = snapshotPlainDataRecord(
    manifest,
    "Release asset module map",
    MAX_RELEASE_MANIFEST_FIELDS,
  );
  const rawModules = snapshotPlainDataRecord(
    manifestSnapshot.modules,
    "Release asset module map",
    MAX_RELEASE_ASSET_MODULES,
  );
  const paths = Object.keys(rawModules);

  const modules: Record<string, string> = Object.create(null);
  for (const path of paths) {
    const entry = snapshotPlainDataRecord(
      rawModules[path],
      "Release asset module entry",
      MAX_RELEASE_ASSET_MODULE_ENTRY_FIELDS,
    );
    const contentHash = entry.contentHash;
    if (typeof contentHash !== "string") {
      throw new TypeError("Release asset module content hash is invalid");
    }
    const url = `/_vf/assets/${contentHash}.js`;
    if (
      path.length === 0 || exceedsUTF8Limit(path, MAX_HTML_PATH_BYTES) || path.startsWith("/") ||
      /[\\?#<>"']/.test(path) || hasPathControlCharacter(path) ||
      hasUnpairedUtf16Surrogate(path) ||
      !RELEASE_ASSET_MODULE_URL_PATTERN.test(url)
    ) throw new TypeError("Release asset module entry is invalid");
    try {
      const normalizedPath = resolveRelativePath(path, ".");
      if (
        normalizedPath !== path.replace(/^\.\//, "") ||
        normalizedPath.split("/").some((segment) => !isSafeHydrationModulePathSegment(segment))
      ) throw new TypeError("Release asset module path is invalid");
      modules[normalizedPath] = url;
    } catch {
      throw new TypeError("Release asset module path is invalid");
    }
  }
  return paths.length > 0 ? modules : undefined;
}

export function generateHydrationData(
  slug: string,
  params: Record<string, string | string[]>,
  props: ComponentProps,
  options: HTMLRuntimeGenerationOptions,
  serializeOptions?: { pretty?: boolean },
): string {
  const runtimeOptions = snapshotPlainDataRecord(
    options,
    "Hydration options",
  ) as unknown as HTMLRuntimeGenerationOptions;
  const runtimeSerializeOptions = serializeOptions === undefined
    ? undefined
    : snapshotPlainDataRecord(
      serializeOptions,
      "Hydration serialization options",
    ) as { pretty?: unknown };
  if (runtimeOptions.mode !== "development" && runtimeOptions.mode !== "production") {
    throw new TypeError("Hydration mode is invalid");
  }
  if (
    runtimeSerializeOptions?.pretty !== undefined &&
    typeof runtimeSerializeOptions.pretty !== "boolean"
  ) {
    throw new TypeError("Hydration serialization options are invalid");
  }
  const config = snapshotPlainDataRecord(runtimeOptions.config, "Hydration config");
  const configuredAppRoot = config.directories === undefined ? undefined : snapshotPlainDataRecord(
    config.directories,
    "Hydration config directories",
  ).app;
  if (typeof slug !== "string" || exceedsUTF8Limit(slug, MAX_HTML_SLUG_BYTES)) {
    throw new TypeError("Hydration slug is invalid");
  }
  if (hasPathControlCharacter(slug) || hasUnpairedUtf16Surrogate(slug)) {
    throw new TypeError("Hydration slug is invalid");
  }
  const safeParams = snapshotHydrationParams(params);
  const jsonSnapshotter = createHydrationJSONSnapshotter();
  const safeProps = jsonSnapshotter.record(props, "Hydration props");
  const safeHeadings = runtimeOptions.headings === undefined
    ? undefined
    : jsonSnapshotter.array(runtimeOptions.headings, "Hydration headings");
  assertValidHydrationHeadings(safeHeadings);
  const safeFrontmatter = runtimeOptions.frontmatter === undefined
    ? undefined
    : jsonSnapshotter.record(runtimeOptions.frontmatter, "Hydration frontmatter");
  const safeLayoutProps = runtimeOptions.layoutProps === undefined
    ? undefined
    : jsonSnapshotter.record(runtimeOptions.layoutProps, "Hydration layout props");
  if (safeLayoutProps !== undefined) {
    assertBoundedPlainRecord(
      safeLayoutProps,
      "Hydration layout props",
      MAX_HTML_NESTED_LAYOUTS,
    );
    for (const [path, value] of Object.entries(safeLayoutProps)) {
      if (
        exceedsUTF8Limit(path, MAX_HTML_PATH_BYTES) ||
        !path.split("/").every(isSafeHydrationModulePathSegment)
      ) {
        throw new TypeError("Hydration layout props contain an invalid path");
      }
      assertBoundedPlainRecord(value, "Hydration layout props entry");
    }
  }
  if (
    runtimeOptions.releaseId !== undefined &&
    (typeof runtimeOptions.releaseId !== "string" || runtimeOptions.releaseId.length === 0 ||
      exceedsUTF8Limit(runtimeOptions.releaseId, MAX_HTML_RELEASE_ID_BYTES) ||
      hasPathControlCharacter(runtimeOptions.releaseId) ||
      hasUnpairedUtf16Surrogate(runtimeOptions.releaseId))
  ) {
    throw new TypeError("Hydration release id is invalid");
  }
  const nestedLayouts = runtimeOptions.nestedLayouts === undefined
    ? []
    : jsonSnapshotter.array(runtimeOptions.nestedLayouts, "Hydration layouts");
  if (nestedLayouts.length > MAX_HTML_NESTED_LAYOUTS) {
    throw new TypeError("Hydration data has too many layouts");
  }
  if (
    runtimeOptions.pageType !== undefined &&
    !PAGE_TYPE_EXTENSIONS.has(runtimeOptions.pageType as PageType)
  ) {
    throw new TypeError("Unsupported hydration page type");
  }
  if (
    runtimeOptions.environment !== undefined && runtimeOptions.environment !== "preview" &&
    runtimeOptions.environment !== "production"
  ) throw new TypeError("Hydration environment is invalid");
  for (
    const [label, value] of [
      ["isolated client page", runtimeOptions.isolatedClientPage],
      ["local project", runtimeOptions.isLocalProject],
      ["Studio embed", runtimeOptions.studioEmbed],
    ] as const
  ) {
    if (value !== undefined && typeof value !== "boolean") {
      throw new TypeError(`Hydration ${label} flag is invalid`);
    }
  }

  const layouts: HydrationDataStructure["layouts"] = nestedLayouts.map((layout) => {
    if (!isPlainRecord(layout)) throw new TypeError("Hydration layout must be an object");
    const kind = layout.kind;
    if (kind !== "mdx" && kind !== "tsx") {
      throw new TypeError("Unsupported nested layout kind");
    }
    return {
      kind,
      path: toProjectRelativePath(
        layout.path ?? layout.componentPath,
        runtimeOptions.projectDir,
        "layout path",
      ),
    };
  });

  const appRouterRoot = toProjectRelativePath(
    runtimeOptions.appRouterRoot ?? configuredAppRoot ?? "app",
    runtimeOptions.projectDir,
    "App Router root",
  ).replace(/^\/+|\/+$/g, "");

  const data: HydrationDataStructure = {
    slug: slug || "",
    props: safeProps,
    params: safeParams,
    layouts,
    appPath: runtimeOptions.appPath
      ? toProjectRelativePath(runtimeOptions.appPath, runtimeOptions.projectDir, "app path")
      : undefined,
    appRouterRoot,
    isolatedClientPage: runtimeOptions.isolatedClientPage,
    pagePath: runtimeOptions.pagePath
      ? toProjectRelativePath(runtimeOptions.pagePath, runtimeOptions.projectDir, "page path")
      : undefined,
    // `options.pageType`/`options.environment` are validated against literal
    // enum schemas (see html.schema.ts), but the schema inference widens them
    // to `string`. Narrow back to the real literal unions rather than `any`.
    pageType: (runtimeOptions.pageType as HydrationPageType | undefined) ||
      inferPageType(runtimeOptions.pagePath),
    clientModuleStrategy: determineClientModuleStrategy({
      isLocalProject: runtimeOptions.isLocalProject,
      environment: runtimeOptions.environment as HydrationEnvironment | undefined,
    }),
    releaseId: runtimeOptions.releaseId,
    releaseAssetModules: buildSafeReleaseAssetModules(runtimeOptions.releaseAssetManifest),
    frontmatter: safeFrontmatter,
    layoutProps: safeLayoutProps as Record<string, Record<string, unknown>> | undefined,
    // In dev mode, client uses createRoot instead of hydrateRoot to avoid
    // hydration mismatches from compilation differences between SSR and client
    dev: runtimeOptions.mode === "development",
    headings: safeHeadings as HydrationDataStructure["headings"],
    studioEmbed: runtimeOptions.studioEmbed,
  };

  const pretty = runtimeSerializeOptions?.pretty ?? true;
  const serialized = jsonForInlineScript(data, pretty ? 2 : undefined);
  if (getUTF8ByteLength(serialized) > MAX_HTML_HYDRATION_DATA_BYTES) {
    throw new TypeError("Hydration data exceeds the size limit");
  }
  return serialized;
}
