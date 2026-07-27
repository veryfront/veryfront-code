import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_MANIFEST_LIMITS,
} from "#veryfront/release-assets/constants.ts";
import type { HydrationDataStructure } from "../hydration-script-builder/types.ts";

const MAX_HYDRATION_ROUTE_TEXT_LENGTH = 2_048;
const MAX_BUILD_VERSION_TEXT_LENGTH = 2_048;
const MAX_HYDRATION_LAYOUTS = 256;
const MAX_HYDRATION_MODULES = 512;
const MAX_HYDRATION_HEADINGS = 10_000;
const MAX_HYDRATION_HEADING_TEXT_LENGTH = 4_096;
const HYDRATION_MODULE_EXTENSION_PATTERN = /\.(?:tsx?|jsx?|mdx?|mjs)$/;
const RELEASE_ASSET_JS_FILENAME_PATTERN = /^[0-9a-f]{64}\.js$/;

function isCanonicalHydrationPath(value: string): boolean {
  if (
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return false;
  }

  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function isCanonicalHydrationModulePath(value: string): boolean {
  return isCanonicalHydrationPath(value) &&
    HYDRATION_MODULE_EXTENSION_PATTERN.test(value);
}

function isInternalReleaseAssetModuleUrl(value: string): boolean {
  const prefix = `${RELEASE_ASSET_BASE_PATH}/`;
  return value.startsWith(prefix) &&
    RELEASE_ASSET_JS_FILENAME_PATTERN.test(value.slice(prefix.length));
}

function hydrationModuleEntryCountWithin(value: object): boolean {
  return Object.keys(value).length <= MAX_HYDRATION_MODULES;
}

export const getColorSchemeSchema = defineSchema((v) => v.enum(["light", "dark"]));

export const getEnvironmentSchema = defineSchema((v) => v.enum(["preview", "production"]));

export const getPageTypeSchema = defineSchema((v) =>
  v.enum(["mdx", "md", "tsx", "jsx", "ts", "js"] as const)
);
export const getClientModuleStrategySchema = defineSchema((v) =>
  v.enum(["fs", "rsc-module"] as const)
);

export const getHTMLGenerationOptionsSchema = defineSchema((v) =>
  v.object({
    mode: v.enum(["development", "production"]),
    // deno-lint-ignore no-explicit-any -- VeryfrontConfig is complex, use any
    config: v.any(), // VeryfrontConfig is complex, use any
    importMap: v.record(v.string(), v.string()).optional(),
    nestedLayouts: v
      .array(
        v.object({
          kind: v.string(),
          path: v.string().optional(),
          componentPath: v.string().optional(),
        }),
      )
      .optional(),
    appPath: v.string().optional(),
    errorPath: v.string().optional(),
    appRouterRoot: v.string().optional(),
    isolatedClientPage: v.boolean().optional(),
    pagePath: v.string().optional(),
    pageType: getPageTypeSchema().optional(),
    nonce: v.string().optional(),
    projectDir: v.string().optional(),
    globalCSS: v.string().optional(),
    frontmatter: v.record(v.string(), v.unknown()).optional(),
    layoutProps: v.record(v.string(), v.record(v.string(), v.unknown())).optional(),
    studioEmbed: v.boolean().optional(),
    projectId: v.string().optional(),
    projectSlug: v.string().optional(),
    releaseId: v.string().optional(),
    pageId: v.string().optional(),
    sourceHash: v.string().optional(),
    colorScheme: getColorSchemeSchema().optional(),
    colorSchemeFromParam: v.boolean().optional(),
    colorSchemeFromHeader: v.boolean().optional(),
    environment: getEnvironmentSchema().optional(),
    headings: v
      .array(
        v.object({
          id: v.string(),
          text: v.string(),
          level: v.number().int().positive(),
        }),
      )
      .optional(),
    projectClasses: v.custom<Set<string>>((val) => val instanceof Set).optional(),
    isLocalProject: v.boolean().optional(),
    noHmr: v.boolean().optional(),
    forceProductionScripts: v.boolean().optional(),
  })
);

export const getHydrationDataSchema = defineSchema<HydrationDataStructure>((v) =>
  v.object({
    slug: v.string().max(MAX_HYDRATION_ROUTE_TEXT_LENGTH),
    props: v.record(v.string(), v.unknown()),
    params: v.record(v.string(), v.union([v.string(), v.array(v.string())])),
    layouts: v.array(
      v.object({
        kind: v.enum(["mdx", "tsx"] as const),
        path: v.string().min(1).max(MAX_HYDRATION_ROUTE_TEXT_LENGTH)
          .refine(isCanonicalHydrationModulePath),
      }).strict(),
    ).max(MAX_HYDRATION_LAYOUTS),
    appPath: v.string().max(MAX_HYDRATION_ROUTE_TEXT_LENGTH)
      .refine(isCanonicalHydrationModulePath).optional(),
    errorPath: v.string().max(MAX_HYDRATION_ROUTE_TEXT_LENGTH)
      .refine(isCanonicalHydrationModulePath).optional(),
    appRouterRoot: v.string().max(MAX_HYDRATION_ROUTE_TEXT_LENGTH)
      .refine(isCanonicalHydrationPath).optional(),
    isolatedClientPage: v.boolean().optional(),
    layoutProps: v.record(
      v.string().max(MAX_HYDRATION_ROUTE_TEXT_LENGTH)
        .refine(isCanonicalHydrationModulePath),
      v.record(v.string(), v.unknown()),
    ).refine((value) => Object.keys(value).length <= MAX_HYDRATION_LAYOUTS).optional(),
    pagePath: v.string().max(MAX_HYDRATION_ROUTE_TEXT_LENGTH)
      .refine(isCanonicalHydrationModulePath).optional(),
    pageType: getPageTypeSchema().optional(),
    clientModuleStrategy: getClientModuleStrategySchema().optional(),
    releaseId: v.string().min(1)
      .max(RELEASE_ASSET_MANIFEST_LIMITS.identifierLength)
      .optional(),
    releaseAssetModules: v.record(
      v.string()
        .min(1)
        .max(RELEASE_ASSET_MANIFEST_LIMITS.manifestKeyLength)
        .refine(isCanonicalHydrationModulePath),
      v.string().refine(isInternalReleaseAssetModuleUrl),
    ).refine(hydrationModuleEntryCountWithin).optional(),
    buildVersion: v.object({
      framework: v.string().min(1).max(MAX_BUILD_VERSION_TEXT_LENGTH),
      serverStart: v.number().int().nonnegative(),
      projectUpdated: v.string().max(MAX_BUILD_VERSION_TEXT_LENGTH).optional(),
    }).strict().optional(),
    frontmatter: v.record(v.string(), v.unknown()).optional(),
    dev: v.boolean().optional(),
    headings: v.array(
      v.object({
        id: v.string().max(MAX_HYDRATION_ROUTE_TEXT_LENGTH),
        text: v.string().max(MAX_HYDRATION_HEADING_TEXT_LENGTH),
        level: v.number().int().positive().max(6),
      }).strict(),
    ).max(MAX_HYDRATION_HEADINGS).optional(),
    studioEmbed: v.boolean().optional(),
  })
);

// Inferred types
export type HTMLGenerationOptions = InferSchema<ReturnType<typeof getHTMLGenerationOptionsSchema>>;
/** Canonical hydration payload type shared by the generator and parser. */
export type HydrationData = HydrationDataStructure;

// Backward compat aliases
export const colorSchemeSchema = lazySchema(getColorSchemeSchema);
export const environmentSchema = lazySchema(getEnvironmentSchema);
export const pageTypeSchema = lazySchema(getPageTypeSchema);
export const clientModuleStrategySchema = lazySchema(getClientModuleStrategySchema);
export const HTMLGenerationOptionsSchema = lazySchema(getHTMLGenerationOptionsSchema);
export const HydrationDataSchema = lazySchema(getHydrationDataSchema);
