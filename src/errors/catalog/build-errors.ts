import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

export const BUILD_ERROR_CATALOG: PartialErrorCatalog = Object.freeze({
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

  "markdown-compile-error": createErrorSolution("markdown-compile-error", {
    title: "Markdown compilation failed",
    message: "Failed to compile Markdown file.",
    steps: [
      "Check for syntax errors in your Markdown file",
      "Ensure frontmatter YAML is valid",
      "Check for unclosed frontmatter blocks",
    ],
    example: `---
title: My Post
---

# Hello World`,
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

  "server-export-strip-failed": createErrorSolution("server-export-strip-failed", {
    title: "Server-only export cannot be removed from the client build",
    message:
      "A route module exports getServerData, getStaticData, or getStaticPaths in a form the " +
      "client build cannot empty. Emitting the module would send the loader, its imports, and " +
      "the values it reads to the browser, so the build stops instead.",
    steps: [
      "Declare the hook directly in the route module as a function or an arrow initializer",
      "Replace a re-export such as `export { loadIt as getServerData }` with a direct declaration",
      "Replace a class or an alias export of the hook with an exported async function",
      "Declare any value the hook reads once, at module scope, not inside a loop head",
      "Move a value the browser also needs into a module the hook imports",
    ],
    tips: [
      "The error message names the export and the declaration form that blocked the removal",
      "A hook declared directly is stripped from the client bundle with everything only it read",
    ],
    example: `// Not supported: no local declaration to empty
import { loadIt } from "./loader.ts";
export { loadIt as getServerData };

// Supported
export async function getServerData(ctx) {
  const { loadIt } = await import("./loader.ts");
  return loadIt(ctx);
}`,
  }),
});
