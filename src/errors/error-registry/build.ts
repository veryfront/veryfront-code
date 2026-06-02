import { defineError } from "../types.ts";

export const BUILD_FAILED = defineError({
  slug: "build-failed",
  category: "BUILD",
  status: 500,
  title: "Build process failed",
  suggestion: "Check the build output for specific errors",
});

export const BUNDLE_ERROR = defineError({
  slug: "bundle-error",
  category: "BUILD",
  status: 500,
  title: "Bundle generation failed",
  suggestion: "Review bundler output for details",
});

export const TYPESCRIPT_ERROR = defineError({
  slug: "typescript-error",
  category: "BUILD",
  status: 500,
  title: "TypeScript compilation error",
  suggestion: "Fix TypeScript errors shown in the output",
});

export const MDX_COMPILE_ERROR = defineError({
  slug: "mdx-compile-error",
  category: "BUILD",
  status: 500,
  title: "MDX compilation failed",
  suggestion: "Check your MDX file syntax",
});

export const ASSET_OPTIMIZATION_ERROR = defineError({
  slug: "asset-optimization-error",
  category: "BUILD",
  status: 500,
  title: "Asset optimization failed",
  suggestion: "Check asset file formats and paths",
});

export const SSG_GENERATION_ERROR = defineError({
  slug: "ssg-generation-error",
  category: "BUILD",
  status: 500,
  title: "Static site generation failed",
  suggestion: "Review SSG configuration and data fetching",
});

export const SOURCEMAP_ERROR = defineError({
  slug: "sourcemap-error",
  category: "BUILD",
  status: 500,
  title: "Source map generation failed",
  suggestion: "Check source map configuration",
});

export const COMPILATION_ERROR = defineError({
  slug: "compilation-error",
  category: "BUILD",
  status: 500,
  title: "Compilation failed",
  suggestion: "Review compiler output for specific errors",
});

/** Registry fragment for BUILD errors (slug → definition). */
export const BUILD_REGISTRY = {
  "build-failed": BUILD_FAILED,
  "bundle-error": BUNDLE_ERROR,
  "typescript-error": TYPESCRIPT_ERROR,
  "mdx-compile-error": MDX_COMPILE_ERROR,
  "asset-optimization-error": ASSET_OPTIMIZATION_ERROR,
  "ssg-generation-error": SSG_GENERATION_ERROR,
  "sourcemap-error": SOURCEMAP_ERROR,
  "compilation-error": COMPILATION_ERROR,
} as const;
