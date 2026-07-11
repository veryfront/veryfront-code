import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getColorSchemeSchema = defineSchema((v) => v.enum(["light", "dark"]));

export const getEnvironmentSchema = defineSchema((v) => v.enum(["preview", "production"]));

export const getPageTypeSchema = defineSchema((v) =>
  v.enum(["mdx", "md", "tsx", "jsx", "ts", "js"])
);
export const getClientModuleStrategySchema = defineSchema((v) => v.enum(["fs", "rsc-module"]));

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

export const getHydrationDataSchema = defineSchema((v) =>
  v.object({
    slug: v.string(),
    props: v.record(v.string(), v.unknown()),
    params: v.record(v.string(), v.union([v.string(), v.array(v.string())])),
    layouts: v.array(
      v.object({
        kind: v.string(),
        path: v.string().optional(),
      }),
    ),
    appPath: v.string().optional(),
    appRouterRoot: v.string().optional(),
    isolatedClientPage: v.boolean().optional(),
    layoutProps: v.record(v.string(), v.record(v.string(), v.unknown())).optional(),
    pagePath: v.string().optional(),
    clientModuleStrategy: getClientModuleStrategySchema().optional(),
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
