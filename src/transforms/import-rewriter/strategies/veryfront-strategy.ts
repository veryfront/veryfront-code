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

    // SSR: Keep veryfront imports as-is (resolved by runtime)
    if (ctx.target === "ssr") {
      const normalized = normalizeVeryfrontSpecifier(specifier);
      if (normalized !== specifier) return { specifier: normalized };
      return { specifier: null };
    }

    // Browser: Convert to module server URLs
    if (specifier.startsWith("#veryfront/")) {
      const path = specifier.slice("#veryfront/".length);
      // Try resolving via deno.json mappings first (veryfront/head → react/components/Head.js)
      const mapped = resolveVeryfrontModuleUrl(`veryfront/${path}`);
      if (mapped) return { specifier: mapped };
      return { specifier: buildVeryfrontModuleUrl(path) };
    }

    const normalized = normalizeVeryfrontSpecifier(specifier);

    if (normalized === "veryfront" || normalized.startsWith("veryfront/")) {
      const mapped = resolveVeryfrontModuleUrl(normalized);
      if (mapped) return { specifier: mapped };
      if (normalized !== specifier) return { specifier: normalized };
      return { specifier: null };
    }

    return { specifier: null };
  }
}

export const veryfrontStrategy = new VeryfrontStrategy();
