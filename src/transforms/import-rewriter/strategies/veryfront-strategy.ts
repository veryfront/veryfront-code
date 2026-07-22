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
 * Module overrides for framework barrels that are too broad for a target.
 *
 * Some modules re-export React hooks alongside heavy server-side code
 * (executors, backends, DAGs) that fails to transform or run in the SSR and
 * browser pipelines. Redirect exact imports to the lightweight React-only
 * submodule for those targets.
 */
const REACT_ONLY_MODULE_OVERRIDES: Record<string, string> = {
  "veryfront/workflow": "/_vf_modules/_veryfront/workflow/react/index.js",
  // The root barrel re-exports the server bootstrap surface from
  // `#veryfront/server`, which transitively pulls `server/production-server.ts`
  // (module top-level await → cannot transform to the es2020 browser target →
  // HTTP 500, aborting hydration). A *used* value import from the barrel (e.g.
  // `import { getEnv } from "veryfront"`) survives dead-code stripping and drags
  // the whole server graph into the client. Redirect to a client/SSR-safe mirror
  // barrel that omits only the server bootstrap value export. See
  // `src/index.client.ts`.
  "veryfront": "/_vf_modules/_veryfront/index.client.js",
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

    // Handle #deno-config, a Deno import-map alias that doesn't exist in
    // browsers. Rewrite to a JS module (not JSON): a browser refuses a JSON
    // module unless the importer carries `with { type: "json" }`, so serving JS
    // keeps the rewrite independent of import attribute support in the browser.
    if (specifier === "#deno-config") {
      return { specifier: "/_vf_modules/_veryfront/_deno-config.js" };
    }

    // Handle #veryfront/* (internal framework imports)
    if (specifier.startsWith("#veryfront/")) {
      const path = specifier.slice("#veryfront/".length);
      // Try resolving via deno.json mappings first (for example,
      // veryfront/head → react/runtime/core.js).
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
      // Redirect broad client-facing barrels to lightweight submodules that
      // exclude server-side dependencies from SSR and browser hydration.
      const override = REACT_ONLY_MODULE_OVERRIDES[specifier];
      if (override !== undefined) {
        if (ctx.target === "ssr") return { specifier: `${override}?ssr=true` };
        if (ctx.target === "browser") return { specifier: override };
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
