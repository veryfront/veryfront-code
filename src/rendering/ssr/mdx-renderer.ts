/**
 * MDX rendering functionality for converting compiled code to React elements.
 * Uses secure ESM dynamic imports instead of eval/new Function.
 * @module
 */

import { rendererLogger as logger } from "@veryfront/utils";
import * as React from "react";
import { CompilationError } from "@veryfront/errors/index.ts";
import { loadCompiledMDXModule } from "./mdx-module-loader.ts";
import type { MDXRenderOptions } from "./types.ts";

/**
 * Asynchronously renders compiled MDX code to a React element.
 * SECURE: Uses ESM dynamic imports instead of new Function() or eval().
 *
 * @param compiledCode - The compiled MDX JavaScript code (ESM format)
 * @param options - Rendering options including frontmatter and components
 * @returns Promise resolving to a React element
 *
 * @example
 * ```ts
 * const element = await renderMDXToReactAsync(compiledCode, {
 *   frontmatter: { title: 'My Page' },
 *   components: { MyComponent }
 * })
 * ```
 */
export async function renderMDXToReactAsync(
  compiledCode: string,
  options: MDXRenderOptions = {},
): Promise<React.ReactElement> {
  try {
    // Generate cache key from code hash for efficient caching
    const cacheKey = await hashCode(compiledCode);

    // Load via secure ESM import (writes to temp file, imports, cleans up)
    const module = await loadCompiledMDXModule(compiledCode, cacheKey);

    const MDXContent = module.default || module.MDXContent;

    if (!MDXContent) {
      throw new CompilationError("No MDXContent found in compiled module");
    }

    // Merge frontmatter from module with user-provided options
    const moduleFrontmatter = module.frontmatter ?? {};
    const optionFrontmatter = options.frontmatter ?? {};
    const mergedProps: Record<string, unknown> = {
      ...(options as Record<string, unknown>),
      frontmatter: {
        ...moduleFrontmatter,
        ...optionFrontmatter,
      },
    };

    // Render the component
    if (React.isValidElement(MDXContent)) {
      return MDXContent;
    }

    if (typeof MDXContent === "function") {
      return React.createElement(
        MDXContent as React.ComponentType<Record<string, unknown>>,
        mergedProps,
      );
    }

    return React.createElement(
      MDXContent as React.ComponentType<Record<string, unknown>>,
      mergedProps,
    );
  } catch (error) {
    logger.error("[MDX] Render error:", error);
    return createErrorElement(error);
  }
}

/**
 * Generates a hash for cache key from code content.
 * Uses Web Crypto API for fast, secure hashing.
 */
async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 16);
}

/**
 * Creates an error display element for render failures.
 *
 * @param error - The error that occurred during rendering
 * @returns A React element displaying the error
 */
function createErrorElement(error: unknown): React.ReactElement {
  return React.createElement(
    "div",
    {
      style: {
        padding: "1rem",
        backgroundColor: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: "0.375rem",
        color: "#dc2626",
      },
    },
    React.createElement("strong", {}, "MDX Render Error: "),
    error instanceof Error ? error.message : String(error),
  );
}
