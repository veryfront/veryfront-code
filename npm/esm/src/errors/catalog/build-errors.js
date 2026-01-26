import { ErrorCode } from "../error-codes.js";
import { createErrorSolution, createSimpleError } from "./factory.js";
export const BUILD_ERROR_CATALOG = {
    [ErrorCode.BUILD_FAILED]: createErrorSolution(ErrorCode.BUILD_FAILED, {
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
    [ErrorCode.BUNDLE_ERROR]: createSimpleError(ErrorCode.BUNDLE_ERROR, "Bundle generation failed", "Failed to generate JavaScript bundles.", [
        "Check for circular dependencies",
        "Ensure all imports are valid",
        "Try clearing cache: veryfront clean",
    ]),
    [ErrorCode.TYPESCRIPT_ERROR]: createSimpleError(ErrorCode.TYPESCRIPT_ERROR, "TypeScript compilation error", "TypeScript found errors in your code.", [
        "Fix the TypeScript errors shown above",
        "Check your tsconfig.json configuration",
        "Ensure all types are properly imported",
    ]),
    [ErrorCode.MDX_COMPILE_ERROR]: createErrorSolution(ErrorCode.MDX_COMPILE_ERROR, {
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
    [ErrorCode.ASSET_OPTIMIZATION_ERROR]: createSimpleError(ErrorCode.ASSET_OPTIMIZATION_ERROR, "Asset optimization failed", "Failed to optimize assets (images, CSS, etc.).", [
        "Check that asset files are valid",
        "Ensure file paths are correct",
        "Try disabling optimization temporarily",
    ]),
    [ErrorCode.SSG_GENERATION_ERROR]: createSimpleError(ErrorCode.SSG_GENERATION_ERROR, "Static site generation failed", "Failed to generate static pages.", [
        "Check that all routes are valid",
        "Ensure getStaticData functions return correctly",
        "Verify no dynamic content requires runtime",
    ]),
    [ErrorCode.SOURCEMAP_ERROR]: createSimpleError(ErrorCode.SOURCEMAP_ERROR, "Source map generation failed", "Failed to generate source maps.", ["Try disabling source maps temporarily", "Check for very large files that might cause issues"]),
};
