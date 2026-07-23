import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import type { HTMLGenerationOptions as SchemaHTMLGenerationOptions } from "./schemas/index.ts";

export type { HTMLMetadata, MDXFrontmatter } from "#veryfront/transforms/mdx/types.ts";
export type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";

// Re-export schema-based types
export type { HTMLGenerationOptions, HydrationData } from "./schemas/index.ts";

/** Internal render context accepted by HTML runtime generation functions. */
export type HTMLRuntimeGenerationOptions = SchemaHTMLGenerationOptions & {
  releaseAssetManifest?: ReleaseAssetManifest | null;
};
