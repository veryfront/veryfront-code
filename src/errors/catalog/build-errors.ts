import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

export const BUILD_ERROR_CATALOG: PartialErrorCatalog = {
  "build-failed": createErrorSolution("build-failed", {
    title: "Build failed",
    message: "The build process encountered errors.",
    steps: [
      "Check the error messages above for specific issues",
      "Fix any TypeScript or syntax errors",
      "Ensure all imports can be resolved",
      "Run 'veryfront doctor' to check your environment",
    ],
    tips: ["Try running with --verbose for more details", "Check build logs for warnings"],
  }),

  "bundle-error": createSimpleError(
    "bundle-error",
    "Bundle generation failed",
    "Failed to generate JavaScript bundles.",
    [
      "Check for circular dependencies",
      "Ensure all imports are valid",
      "Try clearing cache: veryfront clean",
    ],
  ),

  "typescript-error": createSimpleError(
    "typescript-error",
    "TypeScript compilation error",
    "TypeScript found errors in your code.",
    [
      "Fix the TypeScript errors shown above",
      "Check your tsconfig.json configuration",
      "Ensure all types are properly imported",
    ],
  ),

  "mdx-compile-error": createErrorSolution("mdx-compile-error", {
    title: "MDX compilation failed",
    message: "Failed to compile MDX file.",
    steps: [
      "Check for syntax errors in your MDX file",
      "Ensure frontmatter YAML is valid",
      "Verify JSX components are properly imported",
      "Check for unclosed tags or brackets",
    ],
    example: `---
title: My Post
---

import Button from './components/Button.jsx'

# Hello World

<Button>Click me</Button>`,
  }),

  "asset-optimization-error": createSimpleError(
    "asset-optimization-error",
    "Asset optimization failed",
    "Failed to optimize assets (images, CSS, etc.).",
    [
      "Check that asset files are valid",
      "Ensure file paths are correct",
      "Try disabling optimization temporarily",
    ],
  ),

  "ssg-generation-error": createSimpleError(
    "ssg-generation-error",
    "Static site generation failed",
    "Failed to generate static pages.",
    [
      "Check that all routes are valid",
      "Ensure getStaticData functions return correctly",
      "Verify no dynamic content requires runtime",
    ],
  ),

  "sourcemap-error": createSimpleError(
    "sourcemap-error",
    "Source map generation failed",
    "Failed to generate source maps.",
    ["Try disabling source maps temporarily", "Check for very large files that might cause issues"],
  ),

  "compilation-error": createSimpleError(
    "compilation-error",
    "Compilation failed",
    "Failed to compile source code.",
    [
      "Check for syntax errors in the output",
      "Ensure all dependencies are installed",
      "Verify TypeScript configuration",
    ],
  ),
};
