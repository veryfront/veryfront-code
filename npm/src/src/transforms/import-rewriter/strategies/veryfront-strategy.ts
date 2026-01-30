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
} from "../types.js";
import { buildVeryfrontModuleUrl } from "../url-builder.js";

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
      // Normalize @veryfront/ to veryfront/
      if (specifier.startsWith("@veryfront/")) {
        return { specifier: specifier.replace("@veryfront/", "veryfront/") };
      }
      if (specifier === "@veryfront") {
        return { specifier: "veryfront" };
      }
      // Keep #veryfront/* and veryfront/* as-is for SSR
      return { specifier: null };
    }

    // Browser: Convert to module server URLs
    if (specifier.startsWith("#veryfront/")) {
      const path = specifier.slice("#veryfront/".length);
      return { specifier: buildVeryfrontModuleUrl(path) };
    }

    // Browser: Map veryfront/* to module server URLs
    if (specifier.startsWith("veryfront/")) {
      const mapped = VERYFRONT_BROWSER_MAP[specifier];
      if (mapped) {
        return { specifier: mapped };
      }
      // Unknown veryfront/* subpath - convert to module URL as fallback
      const path = specifier.slice("veryfront/".length);
      return { specifier: `/_vf_modules/react/${path}/index.js` };
    }

    // Normalize @veryfront/ to veryfront/ then apply same mapping
    if (specifier.startsWith("@veryfront/")) {
      const normalized = specifier.replace("@veryfront/", "veryfront/");
      const mapped = VERYFRONT_BROWSER_MAP[normalized];
      if (mapped) {
        return { specifier: mapped };
      }
      const path = specifier.slice("@veryfront/".length);
      return { specifier: `/_vf_modules/react/${path}/index.js` };
    }

    if (specifier === "@veryfront" || specifier === "veryfront") {
      return { specifier: "/_vf_modules/react/index.js" };
    }

    return { specifier: null };
  }
}

export const veryfrontStrategy = new VeryfrontStrategy();
