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
import { resolveDependencyPinForImport } from "../dependency-resolution.ts";
import {
  appendDependencyPinningKey,
  appendDependencyPinningPathKey,
  buildVeryfrontModuleUrl,
} from "../url-builder.ts";
import {
  resolveInternalModuleUrl,
  resolveVeryfrontModuleUrl,
} from "../../veryfront-module-urls.ts";

/**
 * Module overrides for framework barrels that are too broad for a target.
 *
 * Some broad modules pull server-only code into browser pipelines. Redirect
 * only where the package intentionally publishes a target-specific root.
 */
const CLIENT_SAFE_MODULE_OVERRIDES: Record<string, string> = {
  // The root barrel re-exports the server bootstrap surface from
  // `#veryfront/server`, which transitively pulls `server/production-server.ts`
  // (module top-level await cannot transform to the es2020 browser target,
  // HTTP 500, aborting hydration). A *used* value import from the barrel (e.g.
  // `import { getEnv } from "veryfront"`) survives dead-code stripping and drags
  // the whole server graph into the client. Redirect to a client/SSR-safe mirror
  // barrel that omits only the server bootstrap value export. See
  // `src/index.client.ts`.
  "veryfront": "/_vf_modules/_veryfront/index.client.js",
};

function finalizeInternalModuleUrl(url: string, ctx: RewriteContext): string {
  const targetUrl = ctx.target === "ssr" ? `${url}?ssr=true` : url;
  return ctx.target === "browser"
    ? appendDependencyPinningPathKey(targetUrl, ctx.dependencyPinningCacheKey)
    : appendDependencyPinningKey(targetUrl, ctx.dependencyPinningCacheKey);
}

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
      return {
        specifier: ctx.target === "browser"
          ? appendDependencyPinningPathKey(
            "/_vf_modules/_veryfront/_deno-config.js",
            ctx.dependencyPinningCacheKey,
          )
          : appendDependencyPinningKey(
            "/_vf_modules/_veryfront/_deno-config.js",
            ctx.dependencyPinningCacheKey,
          ),
      };
    }

    // Handle #veryfront/* (internal framework imports)
    if (specifier.startsWith("#veryfront/")) {
      const path = specifier.slice("#veryfront/".length);
      // Try resolving via deno.json mappings first (for example,
      // veryfront/head → react/runtime/core.js).
      const mapped = resolveVeryfrontModuleUrl(`veryfront/${path}`);
      if (mapped) {
        return { specifier: finalizeInternalModuleUrl(mapped, ctx) };
      }
      // Try resolving via #veryfront/* import map (handles paths where the
      // filesystem layout differs from the specifier, e.g. #veryfront/compat/console
      // maps to src/platform/compat/console/index.ts, not src/compat/console.ts)
      const internalMapped = resolveInternalModuleUrl(specifier);
      if (internalMapped) {
        return { specifier: finalizeInternalModuleUrl(internalMapped, ctx) };
      }
      const builtUrl = buildVeryfrontModuleUrl(path);
      return { specifier: finalizeInternalModuleUrl(builtUrl, ctx) };
    }

    // Handle veryfront/* imports
    if (specifier === "veryfront" || specifier.startsWith("veryfront/")) {
      resolveDependencyPinForImport("veryfront", ctx);

      // Redirect broad client-facing barrels to lightweight submodules that
      // exclude server-side dependencies from SSR and browser hydration.
      const override = CLIENT_SAFE_MODULE_OVERRIDES[specifier];
      if (override !== undefined) {
        return { specifier: finalizeInternalModuleUrl(override, ctx) };
      }

      const mapped = resolveVeryfrontModuleUrl(specifier);
      if (mapped) {
        return { specifier: finalizeInternalModuleUrl(mapped, ctx) };
      }
      return { specifier: null };
    }

    return { specifier: null };
  }
}

export const veryfrontStrategy = new VeryfrontStrategy();
