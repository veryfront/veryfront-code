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

/**
 * Map veryfront/* bare specifiers to /_vf_modules/ paths for browser.
 * These modules are served by the module server from the framework's React components.
 */
const VERYFRONT_BROWSER_MAP: Record<string, string> = {
  "veryfront/head": "/_vf_modules/react/components/Head.js",
  "veryfront/router": "/_vf_modules/react/router/index.js",
  "veryfront/context": "/_vf_modules/react/context/index.js",
  "veryfront/fonts": "/_vf_modules/react/fonts/index.js",
};

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
      return { specifier: buildVeryfrontModuleUrl(path) };
    }

    const normalized = normalizeVeryfrontSpecifier(specifier);

    if (normalized === "veryfront") {
      return { specifier: "/_vf_modules/react/index.js" };
    }

    if (normalized.startsWith("veryfront/")) {
      const mapped = VERYFRONT_BROWSER_MAP[normalized];
      if (mapped) return { specifier: mapped };

      const path = normalized.slice("veryfront/".length);
      return { specifier: `/_vf_modules/react/${path}/index.js` };
    }

    return { specifier: null };
  }
}

export const veryfrontStrategy = new VeryfrontStrategy();
