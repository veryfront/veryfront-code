import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  type VeryfrontConfig,
  veryfrontConfigSchema,
} from "#veryfront/config/schemas/config.schema.ts";
import {
  getUTF8ByteLength,
  MAX_HTML_HEADINGS,
  MAX_HTML_IMPORT_MAP_BYTES,
  MAX_HTML_IMPORT_MAP_ENTRIES,
  MAX_HTML_IMPORT_SPECIFIER_BYTES,
  MAX_HTML_IMPORT_VALUE_BYTES,
  MAX_HTML_NESTED_LAYOUTS,
  MAX_HTML_NONCE_BYTES,
  MAX_HTML_PATH_BYTES,
  MAX_HTML_RELEASE_ID_BYTES,
  MAX_HTML_SLUG_BYTES,
  MAX_HTML_SOURCE_HASH_BYTES,
} from "../limits.ts";
import { MAX_STUDIO_CONFIG_ID_LENGTH } from "#veryfront/studio/limits.ts";
import {
  MAX_CSS_CANDIDATE_BYTES,
  MAX_CSS_CANDIDATES,
  MAX_STYLESHEET_BYTES,
  MAX_TOTAL_CSS_CANDIDATE_BYTES,
} from "../styles-builder/resource-limits.ts";

const PROJECT_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function hasBoundedImportMap(value: Record<string, string>): boolean {
  const entries = Object.entries(value);
  if (entries.length > MAX_HTML_IMPORT_MAP_ENTRIES) return false;
  let bytes = 0;
  for (const [specifier, importValue] of entries) {
    bytes += getUTF8ByteLength(specifier) + getUTF8ByteLength(importValue);
    if (bytes > MAX_HTML_IMPORT_MAP_BYTES) return false;
  }
  return true;
}

function hasBoundedProjectClasses(value: unknown): value is Set<string> {
  if (!(value instanceof Set)) return false;
  const size = Object.getOwnPropertyDescriptor(Set.prototype, "size")?.get?.call(value) as number;
  if (size > MAX_CSS_CANDIDATES) return false;

  let bytes = 0;
  for (const candidate of Set.prototype.values.call(value)) {
    if (typeof candidate !== "string") return false;
    const candidateBytes = getUTF8ByteLength(candidate);
    if (candidateBytes > MAX_CSS_CANDIDATE_BYTES) return false;
    bytes += candidateBytes;
    if (bytes > MAX_TOTAL_CSS_CANDIDATE_BYTES) return false;
  }
  return true;
}

const boundedPath = (v: Parameters<Parameters<typeof defineSchema>[0]>[0]) =>
  v.string().max(MAX_HTML_PATH_BYTES);

const headingSchema = (v: Parameters<Parameters<typeof defineSchema>[0]>[0]) =>
  v.object({
    id: v.string().max(MAX_HTML_PATH_BYTES),
    text: v.string().max(MAX_HTML_PATH_BYTES),
    level: v.number().int().min(1).max(6),
  });

export const getColorSchemeSchema = defineSchema((v) => v.enum(["light", "dark"]));

export const getEnvironmentSchema = defineSchema((v) => v.enum(["preview", "production"]));

export const getPageTypeSchema = defineSchema((v) =>
  v.enum(["mdx", "md", "tsx", "jsx", "ts", "js"])
);
export const getClientModuleStrategySchema = defineSchema((v) => v.enum(["fs", "rsc-module"]));

export const getHTMLGenerationOptionsSchema = defineSchema((v) =>
  v.object({
    mode: v.enum(["development", "production"]),
    config: v.custom<VeryfrontConfig>((value) => veryfrontConfigSchema.safeParse(value).success),
    importMap: v
      .record(
        v.string().min(1).max(MAX_HTML_IMPORT_SPECIFIER_BYTES),
        v.string().min(1).max(MAX_HTML_IMPORT_VALUE_BYTES),
      )
      .refine(hasBoundedImportMap, "Import map exceeds its resource limits")
      .optional(),
    nestedLayouts: v
      .array(
        v.object({
          kind: v.enum(["mdx", "tsx"]),
          path: boundedPath(v).optional(),
          componentPath: boundedPath(v).optional(),
        }),
      )
      .max(MAX_HTML_NESTED_LAYOUTS)
      .optional(),
    appPath: boundedPath(v).optional(),
    appRouterRoot: boundedPath(v).optional(),
    isolatedClientPage: v.boolean().optional(),
    pagePath: boundedPath(v).optional(),
    pageType: getPageTypeSchema().optional(),
    nonce: v.string().max(MAX_HTML_NONCE_BYTES).optional(),
    projectDir: boundedPath(v).optional(),
    globalCSS: v.string().max(MAX_STYLESHEET_BYTES).optional(),
    frontmatter: v.record(v.string(), v.unknown()).optional(),
    layoutProps: v.record(v.string(), v.record(v.string(), v.unknown())).optional(),
    studioEmbed: v.boolean().optional(),
    studioProjectId: v.string().max(MAX_STUDIO_CONFIG_ID_LENGTH).optional(),
    studioPagePath: boundedPath(v).optional(),
    projectId: v.string().min(1).max(128).regex(PROJECT_SCOPE_PATTERN).optional(),
    projectSlug: v.string().min(1).max(128).regex(PROJECT_SCOPE_PATTERN).optional(),
    releaseId: v.string().min(1).max(MAX_HTML_RELEASE_ID_BYTES).optional(),
    pageId: v.string().min(1).max(MAX_STUDIO_CONFIG_ID_LENGTH).optional(),
    sourceHash: v.string().min(1).max(MAX_HTML_SOURCE_HASH_BYTES).optional(),
    colorScheme: getColorSchemeSchema().optional(),
    colorSchemeFromParam: v.boolean().optional(),
    colorSchemeFromHeader: v.boolean().optional(),
    environment: getEnvironmentSchema().optional(),
    headings: v.array(headingSchema(v)).max(MAX_HTML_HEADINGS).optional(),
    projectClasses: v.custom<Set<string>>(hasBoundedProjectClasses).optional(),
    isLocalProject: v.boolean().optional(),
    noHmr: v.boolean().optional(),
    forceProductionScripts: v.boolean().optional(),
  })
);

export const getHydrationDataSchema = defineSchema((v) =>
  v.object({
    slug: v.string().max(MAX_HTML_SLUG_BYTES),
    props: v.record(v.string(), v.unknown()),
    params: v.record(v.string(), v.union([v.string(), v.array(v.string())])),
    layouts: v
      .array(
        v.object({
          kind: v.enum(["mdx", "tsx"]),
          path: boundedPath(v),
        }),
      )
      .max(MAX_HTML_NESTED_LAYOUTS),
    appPath: boundedPath(v).optional(),
    appRouterRoot: boundedPath(v).optional(),
    isolatedClientPage: v.boolean().optional(),
    layoutProps: v.record(v.string(), v.record(v.string(), v.unknown())).optional(),
    pagePath: boundedPath(v).optional(),
    pageType: getPageTypeSchema().optional(),
    clientModuleStrategy: getClientModuleStrategySchema().optional(),
    releaseId: v.string().min(1).max(MAX_HTML_RELEASE_ID_BYTES).optional(),
    releaseAssetModules: v
      .record(
        v.string().min(1).max(MAX_HTML_PATH_BYTES),
        v.string().min(1).max(MAX_HTML_PATH_BYTES),
      )
      .refine(
        (value) => Object.keys(value).length <= 10_000,
        "Release asset module map exceeds the entry limit",
      )
      .optional(),
    frontmatter: v.record(v.string(), v.unknown()).optional(),
    dev: v.boolean().optional(),
    headings: v.array(headingSchema(v)).max(MAX_HTML_HEADINGS).optional(),
    studioEmbed: v.boolean().optional(),
  })
);

// Inferred types
export type HTMLGenerationOptions = InferSchema<ReturnType<typeof getHTMLGenerationOptionsSchema>>;
export type HydrationData = InferSchema<ReturnType<typeof getHydrationDataSchema>>;

// Backward compat aliases
export const colorSchemeSchema = lazySchema(getColorSchemeSchema);
export const environmentSchema = lazySchema(getEnvironmentSchema);
export const pageTypeSchema = lazySchema(getPageTypeSchema);
export const clientModuleStrategySchema = lazySchema(getClientModuleStrategySchema);
export const HTMLGenerationOptionsSchema = lazySchema(getHTMLGenerationOptionsSchema);
export const HydrationDataSchema = lazySchema(getHydrationDataSchema);
