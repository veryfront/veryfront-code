
import { rendererLogger as logger } from "@veryfront/utils";
import { CompilationError } from "@veryfront/errors/index.ts";
import type { MDXModule } from "./types.ts";

const browserMDXCache = new Map<string, MDXModule>();

export async function loadCompiledMDXInBrowser(
  compiledCode: string,
  cacheKey: string,
): Promise<MDXModule> {
  const cached = browserMDXCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const moduleCode = wrapForBrowser(compiledCode);

    const blob = new Blob([moduleCode], { type: "application/javascript" });
    const blobURL = URL.createObjectURL(blob);

    try {
      const module = await import(blobURL) as MDXModule;

      const MDXContent = module.default || module.MDXContent;

      if (!MDXContent) {
        throw new CompilationError("No default export found in MDX module", {
          cacheKey,
          codePreview: compiledCode.substring(0, 200),
        });
      }

      browserMDXCache.set(cacheKey, module);

      return module;
    } finally {
      URL.revokeObjectURL(blobURL);
    }
  } catch (error) {
    logger.error("[MDX] Browser load failed:", { cacheKey, error });
    throw new CompilationError(
      `Failed to load MDX in browser: ${error instanceof Error ? error.message : String(error)}`,
      { cacheKey },
    );
  }
}

function wrapForBrowser(compiledCode: string): string {
  const imports = `
import * as React from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';

const _jsx = jsx;
const _jsxs = jsxs;
const _jsxDEV = jsx;
const _Fragment = Fragment;
`.trim();

  return `${imports}\n\n${compiledCode}`;
}

export function clearBrowserMDXCache(): void {
  browserMDXCache.clear();
}

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}
