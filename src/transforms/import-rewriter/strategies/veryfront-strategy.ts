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
import {
  resolveInternalModuleUrl,
  resolveVeryfrontModuleUrl,
} from "../../veryfront-module-urls.ts";

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
      specifier === "veryfront" ||
      specifier === "#deno-config"
    );
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    const specifier = info.specifier;

    // Handle #deno-config — Deno import-map alias that doesn't exist in browsers.
    // Rewrite to an embedded polyfill served by the module server.
    if (specifier === "#deno-config") {
      return { specifier: "/_vf_modules/_deno-config.js" };
    }

    // Handle #veryfront/* (internal framework imports)
    if (specifier.startsWith("#veryfront/")) {
      const path = specifier.slice("#veryfront/".length);
      // Try resolving via deno.json mappings first (veryfront/head → react/components/Head.js)
      const mapped = resolveVeryfrontModuleUrl(`veryfront/${path}`);
      if (mapped) {
        if (ctx.target === "ssr") return { specifier: `${mapped}?ssr=true` };
        return { specifier: mapped };
      }
      // Try resolving via #veryfront/* import map (handles paths where the
      // filesystem layout differs from the specifier, e.g. #veryfront/compat/console
      // maps to src/platform/compat/console/index.ts, not src/compat/console.ts)
      const internalMapped = resolveInternalModuleUrl(specifier);
      if (internalMapped) {
        if (ctx.target === "ssr") return { specifier: `${internalMapped}?ssr=true` };
        return { specifier: internalMapped };
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
