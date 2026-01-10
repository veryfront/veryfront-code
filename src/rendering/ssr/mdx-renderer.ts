import { rendererLogger as logger } from "@veryfront/utils";
import * as React from "react";
import { CompilationError } from "@veryfront/errors/index.ts";
import { loadCompiledMDXModule } from "./mdx-module-loader.ts";
import type { MDXRenderOptions } from "./types.ts";

export async function renderMDXToReactAsync(
  compiledCode: string,
  options: MDXRenderOptions = {},
): Promise<React.ReactElement> {
  try {
    const cacheKey = await hashCode(compiledCode);
    const module = await loadCompiledMDXModule(compiledCode, cacheKey);

    const MDXContent = module.default || module.MDXContent;

    if (!MDXContent) {
      throw new CompilationError("No MDXContent found in compiled module");
    }

    const moduleFrontmatter = module.frontmatter ?? {};
    const optionFrontmatter = options.frontmatter ?? {};
    const mergedProps: Record<string, unknown> = {
      ...(options as Record<string, unknown>),
      frontmatter: {
        ...moduleFrontmatter,
        ...optionFrontmatter,
      },
    };

    if (React.isValidElement(MDXContent)) {
      return MDXContent;
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

async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 16);
}

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
