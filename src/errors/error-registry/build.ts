import { defineError, type ErrorRegistryFragment, type RegisteredError } from "../types.ts";

/** Registered error definition for the build-failed slug. */
export const BUILD_FAILED: RegisteredError = defineError({
  slug: "build-failed",
  category: "BUILD",
  status: 500,
  title: "Build process failed",
  suggestion: "Check the build output for specific errors",
});

/** Registered error definition for the bundle-error slug. */
export const BUNDLE_ERROR: RegisteredError = defineError({
  slug: "bundle-error",
  category: "BUILD",
  status: 500,
  title: "Bundle generation failed",
  suggestion: "Review bundler output for details",
});

/** Registered error definition for the typescript-error slug. */
export const TYPESCRIPT_ERROR: RegisteredError = defineError({
  slug: "typescript-error",
  category: "BUILD",
  status: 500,
  title: "TypeScript compilation error",
  suggestion: "Fix TypeScript errors shown in the output",
});

/** Registered error definition for the mdx-compile-error slug. */
export const MDX_COMPILE_ERROR: RegisteredError = defineError({
  slug: "mdx-compile-error",
  category: "BUILD",
  status: 500,
  title: "MDX compilation failed",
  suggestion: "Check your MDX file syntax",
});

/** Registered error definition for the asset-optimization-error slug. */
export const ASSET_OPTIMIZATION_ERROR: RegisteredError = defineError({
  slug: "asset-optimization-error",
  category: "BUILD",
  status: 500,
  title: "Asset optimization failed",
  suggestion: "Check asset file formats and paths",
});

/** Registered error definition for the ssg-generation-error slug. */
export const SSG_GENERATION_ERROR: RegisteredError = defineError({
  slug: "ssg-generation-error",
  category: "BUILD",
  status: 500,
  title: "Static site generation failed",
  suggestion: "Review SSG configuration and data fetching",
});

/** Registered error definition for the sourcemap-error slug. */
export const SOURCEMAP_ERROR: RegisteredError = defineError({
  slug: "sourcemap-error",
  category: "BUILD",
  status: 500,
  title: "Source map generation failed",
  suggestion: "Check source map configuration",
});

/** Registered error definition for the compilation-error slug. */
export const COMPILATION_ERROR: RegisteredError = defineError({
  slug: "compilation-error",
  category: "BUILD",
  status: 500,
  title: "Compilation failed",
  suggestion: "Review compiler output for specific errors",
});

/** Registry fragment for BUILD errors (slug → definition). */
export const BUILD_REGISTRY: ErrorRegistryFragment<
  | "build-failed"
  | "bundle-error"
  | "typescript-error"
  | "mdx-compile-error"
  | "asset-optimization-error"
  | "ssg-generation-error"
  | "sourcemap-error"
  | "compilation-error"
> = Object.freeze(
  {
    "build-failed": BUILD_FAILED,
    "bundle-error": BUNDLE_ERROR,
    "typescript-error": TYPESCRIPT_ERROR,
    "mdx-compile-error": MDX_COMPILE_ERROR,
    "asset-optimization-error": ASSET_OPTIMIZATION_ERROR,
    "ssg-generation-error": SSG_GENERATION_ERROR,
    "sourcemap-error": SOURCEMAP_ERROR,
    "compilation-error": COMPILATION_ERROR,
  } as const,
);
