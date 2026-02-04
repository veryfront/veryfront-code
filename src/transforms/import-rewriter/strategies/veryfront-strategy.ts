/**
 * Veryfront framework import rewriting strategy.
 *
 * Priority: 1.5
 * Handles: #veryfront/*, veryfront/*, @veryfront/*
 */

import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import { buildVeryfrontModuleUrl } from "../url-builder.ts";
import { resolveVeryfrontModuleUrl } from "../../veryfront-module-urls.ts";

function normalizeVeryfrontSpecifier(specifier: string): string {
  if (specifier === "@veryfront") return "veryfront";
  if (specifier.startsWith("@veryfront/")) {
    return specifier.replace("@veryfront/", "veryfront/");
  }
  return specifier;
}

export class VeryfrontStrategy implements ImportRewriteStrategy {
  readonly name = "veryfront";
  readonly priority = 1.5;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return (
      specifier.startsWith("#veryfront/") ||
      specifier.startsWith("veryfront/") ||
      specifier.startsWith("@veryfront/") ||
      specifier === "veryfront" ||
      specifier === "@veryfront"
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

    const normalized = normalizeVeryfrontSpecifier(specifier);

    // Handle veryfront/* and @veryfront/* imports
    if (normalized === "veryfront" || normalized.startsWith("veryfront/")) {
      const mapped = resolveVeryfrontModuleUrl(normalized);
      if (mapped) {
        // For SSR, append ?ssr=true to signal server-side rendering
        // This ensures ssrVfModulesPlugin can identify and resolve these imports
        if (ctx.target === "ssr") return { specifier: `${mapped}?ssr=true` };
        return { specifier: mapped };
      }
      if (normalized !== specifier) return { specifier: normalized };
      return { specifier: null };
    }

    return { specifier: null };
  }
}

export const veryfrontStrategy = new VeryfrontStrategy();
