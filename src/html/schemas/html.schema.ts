import { z } from "zod";

export const colorSchemeSchema = z.enum(["light", "dark"]);

export const environmentSchema = z.enum(["preview", "production"]);

export const pageTypeSchema = z.enum(["mdx", "md", "tsx", "jsx", "ts", "js"]);

export const HTMLGenerationOptionsSchema = z.object({
  mode: z.enum(["development", "production"]),
  config: z.any(), // VeryfrontConfig is complex, use any
  importMap: z.record(z.string()).optional(),
  nestedLayouts: z
    .array(
      z.object({
        kind: z.string(),
        path: z.string().optional(),
        componentPath: z.string().optional(),
      }),
    )
    .optional(),
  appPath: z.string().optional(),
  pagePath: z.string().optional(),
  pageType: pageTypeSchema.optional(),
  nonce: z.string().optional(),
  projectDir: z.string().optional(),
  globalCSS: z.string().optional(),
  frontmatter: z.record(z.unknown()).optional(),
  layoutProps: z.record(z.record(z.unknown())).optional(),
  studioEmbed: z.boolean().optional(),
  projectId: z.string().optional(),
  pageId: z.string().optional(),
  sourceHash: z.string().optional(),
  colorScheme: colorSchemeSchema.optional(),
  colorSchemeFromParam: z.boolean().optional(),
  colorSchemeFromHeader: z.boolean().optional(),
  environment: environmentSchema.optional(),
  headings: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        level: z.number().int().positive(),
      }),
    )
    .optional(),
  projectClasses: z.set(z.string()).optional(),
  isLocalProject: z.boolean().optional(),
  noHmr: z.boolean().optional(),
});

export const HydrationDataSchema = z.object({
  slug: z.string(),
  props: z.record(z.unknown()),
  params: z.record(z.union([z.string(), z.array(z.string())])),
  layouts: z.array(
    z.object({
      kind: z.string(),
      path: z.string().optional(),
    }),
  ),
  appPath: z.string().optional(),
  pagePath: z.string().optional(),
});

// Inferred types
export type HTMLGenerationOptions = z.infer<typeof HTMLGenerationOptionsSchema>;
export type HydrationData = z.infer<typeof HydrationDataSchema>;
