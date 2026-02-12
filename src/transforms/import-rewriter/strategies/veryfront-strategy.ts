/**
 * Veryfront framework import rewriting strategy.
 *
 * Priority: 1.5
 * Handles: #veryfront/*, veryfront/*
 */

import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { buildVeryfrontModuleUrl } from "../url-builder.ts";
import { resolveVeryfrontModuleUrl } from "../../veryfront-module-urls.ts";

/**
 * SSR-specific module overrides.
 *
 * Some modules re-export React hooks alongside heavy server-side code
 * (executors, backends, DAGs) that fails to transform in the SSR pipeline.
 * For SSR, redirect to the lightweight React-only submodule.
 */
const SSR_MODULE_OVERRIDES: Record<string, string> = {
  "veryfront/workflow": "/_vf_modules/_veryfront/workflow/react/index.js",
};

export class VeryfrontStrategy implements ImportRewriteStrategy {
  readonly name = "veryfront";
  readonly priority = 1.5;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return (
      specifier.startsWith("#veryfront/") ||
      specifier.startsWith("veryfront/") ||
      specifier === "veryfront"
    );
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    const specifier = info.specifier;

    // Handle #veryfront/* (internal framework imports)
    if (specifier.startsWith("#veryfront/")) {
      const path = specifier.slice("#veryfront/".length);
      // Try resolving via deno.json mappings first (veryfront/head → react/components/Head.js)
      const mapped = resolveVeryfrontModuleUrl(`veryfront/${path}`);
      if (mapped) {
        // For SSR, append ?ssr=true to signal server-side rendering
        if (ctx.target === "ssr") return { specifier: `${mapped}?ssr=true` };
        return { specifier: mapped };
      }
      const builtUrl = buildVeryfrontModuleUrl(path);
      if (ctx.target === "ssr") return { specifier: `${builtUrl}?ssr=true` };
      return { specifier: builtUrl };
    }

    // Handle veryfront/* imports
    if (specifier === "veryfront" || specifier.startsWith("veryfront/")) {
      // SSR overrides: redirect to lightweight submodules that exclude
      // heavy server-side deps which fail to transform in the SSR pipeline
      if (ctx.target === "ssr" && specifier in SSR_MODULE_OVERRIDES) {
        return { specifier: `${SSR_MODULE_OVERRIDES[specifier]}?ssr=true` };
      }

      const mapped = resolveVeryfrontModuleUrl(specifier);
      if (mapped) {
        if (ctx.target === "ssr") return { specifier: `${mapped}?ssr=true` };
        return { specifier: mapped };
      }
      return { specifier: null };
    }

    return { specifier: null };
  }
}

export const veryfrontStrategy = new VeryfrontStrategy();
