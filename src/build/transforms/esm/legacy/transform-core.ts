import * as esbuild from "esbuild/mod.js"; // Use native esbuild, not WASM
import { generateCacheKey, getCachedTransform, setCachedTransform } from "./transform-cache.ts";
import { computeContentHash, getLoaderFromPath } from "./transform-utils.ts";
import { addDepsToEsmShUrls, resolveReactImports } from "./react-imports.ts";
import {
  blockExternalUrlImports,
  resolveCrossProjectImports,
  resolvePathAliases,
  resolveRelativeImports,
  resolveRelativeImportsForSSR,
  resolveVeryfrontImports,
} from "./path-resolver.ts";
import { rewriteBareImports, rewriteVendorImports } from "./import-rewriter.ts";
import { bundleHttpImports } from "./http-bundler.ts";
import type { TransformOptions } from "./types.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { compileMDXRuntime } from "../mdx/compiler/mdx-compiler.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { cwd } from "../../../platform/compat/process.ts";
import { join } from "std/path/mod.ts";
import {
  getDefaultImportMap,
  transformImportsWithMap,
} from "@veryfront/modules/import-map/index.ts";

export async function transformToESM(
  source: string,
  filePath: string,
  projectDir: string,
  _adapter: RuntimeAdapter,
  options: TransformOptions,
): Promise<string> {
  const transformStart = performance.now();
  const timings: Record<string, number> = {};

  const {
    dev = true,
    projectId,
    jsxImportSource = "react",
    moduleServerUrl,
    vendorBundleHash,
    ssr = false,
  } = options;

  const hashStart = performance.now();
  const contentHash = await computeContentHash(source);
  timings.hash = performance.now() - hashStart;

  const cacheKey = generateCacheKey(projectId, filePath, contentHash, ssr);

  const cached = getCachedTransform(cacheKey);
  if (cached) {
    return cached.code;
  }

  // If this is an MDX file, compile it to JSX first
  let transformSource = source;
  if (filePath.endsWith(".mdx")) {
    const mdxStart = performance.now();
    // Use appropriate target based on SSR mode
    // SSR needs "server" target to use file:// paths, browser needs module server URLs
    const mdxTarget = ssr ? "server" : "browser";
    const mdxBaseUrl = ssr ? undefined : moduleServerUrl;
    const mdxResult = await compileMDXRuntime(
      dev ? "development" : "production",
      projectDir,
      source,
      undefined,
      filePath,
      mdxTarget,
      mdxBaseUrl,
    );
    transformSource = mdxResult.compiledCode;
    timings.mdx = performance.now() - mdxStart;
  }

  const esbuildStart = performance.now();
  const loader = getLoaderFromPath(filePath);

  let result: esbuild.TransformResult;
  try {
    result = await esbuild.transform(transformSource, {
      loader,
      format: "esm",
      target: "es2020",
      jsx: "automatic",
      jsxImportSource,
      minify: !dev,
      sourcemap: dev ? "inline" : false,
      treeShaking: !dev, // Disable in dev mode to preserve import errors
      keepNames: true,
    });
  } catch (transformError) {
    // Structured debugging for transform errors
    const sourcePreview = transformSource.split("\n").slice(0, 10).map((line, i) =>
      `${String(i + 1).padStart(3, " ")}| ${line}`
    ).join("\n");

    logger.error("[ESM-TRANSFORM] Transform failed", {
      filePath,
      loader,
      sourceLength: transformSource.length,
      isMdx: filePath.endsWith(".mdx"),
      error: transformError instanceof Error ? transformError.message : String(transformError),
    });
    logger.error("[ESM-TRANSFORM] Source preview (first 10 lines):\n" + sourcePreview);

    // Re-throw with enhanced error message
    const errorMsg = transformError instanceof Error
      ? transformError.message
      : String(transformError);
    throw new Error(`ESM transform failed for ${filePath} (loader: ${loader}): ${errorMsg}`);
  }
  timings.esbuild = performance.now() - esbuildStart;

  const rewriteStart = performance.now();
  let code = result.code;

  // In dev mode for browser, rewrite hardcoded project domain URLs to use current origin
  // This allows fetch calls to work against the local dev server
  if (dev && !ssr) {
    // Match patterns like: "https://codersociety.com" or 'https://codersociety.com'
    // Rewrite to location.origin for relative URL resolution
    code = code.replace(
      /(['"])https?:\/\/[a-zA-Z0-9-]+\.(?:com|org|net|io|dev|app|veryfront\.com)\1/g,
      "location.origin",
    );
  }

  code = await resolveReactImports(code, ssr);
  code = await addDepsToEsmShUrls(code, ssr);
  code = await resolvePathAliases(code, filePath, projectDir, ssr);

  // Resolve cross-project versioned imports (e.g., demo@0.0.1/@/components/Button)
  // Must be done before other import rewrites since it transforms to absolute URLs
  // Try to get API base URL from options, env var, or default
  const apiBaseUrl = options.apiBaseUrl ||
    Deno.env.get("VERYFRONT_API_BASE_URL") ||
    Deno.env.get("VERYFRONT_API_URL")?.replace("/graphql", "/api") ||
    "http://api.lvh.me:4000/api";

  code = await resolveCrossProjectImports(code, {
    apiBaseUrl,
    ssr,
  });

  // Different import resolution strategies for SSR vs browser
  if (ssr) {
    // SSR: Block external URL imports (https://) from unknown hosts
    // Allowed CDN hosts (esm.sh, deno.land) are kept as-is
    const urlBlockResult = await blockExternalUrlImports(code, filePath);
    code = urlBlockResult.code;
    if (urlBlockResult.blockedUrls.length > 0) {
      logger.warn("[ESM-TRANSFORM] Blocked external URL imports in SSR mode", {
        file: filePath.slice(-60),
        blockedUrls: urlBlockResult.blockedUrls,
      });
    }

    // SSR: Keep relative imports but normalize extensions to .js
    // SSRModuleLoader ensures all dependencies are transformed to temp directory
    code = await resolveRelativeImportsForSSR(code);
    // Rewrite @veryfront/* imports for npm compatibility (both Node.js and Deno)
    code = await resolveVeryfrontImports(code);

    // SSR: Apply import map to normalize esm.sh URLs to npm: specifiers
    // This ensures all imports of the same package use the same module instance,
    // preventing React context mismatch issues
    code = transformImportsWithMap(code, getDefaultImportMap(), undefined, { resolveBare: true });

    // SSR: Process remaining HTTP imports (ones not in import map)
    const httpCacheDir = join(cwd(), ".cache", "veryfront-http-bundle");
    code = bundleHttpImports(code, httpCacheDir, contentHash);
  } else {
    // Browser: Rewrite imports to use module server (HTTP paths)
    code = await resolveRelativeImports(code, filePath, projectDir, moduleServerUrl);

    if (moduleServerUrl && vendorBundleHash) {
      code = await rewriteVendorImports(code, moduleServerUrl, vendorBundleHash);
    } else {
      code = await rewriteBareImports(code, moduleServerUrl);
    }
  }
  timings.rewrite = performance.now() - rewriteStart;

  setCachedTransform(cacheKey, code, contentHash);

  const totalMs = performance.now() - transformStart;
  logger.debug("[ESM-TRANSFORM] Timing breakdown", {
    file: filePath.slice(-40),
    totalMs: totalMs.toFixed(1),
    hashMs: timings.hash?.toFixed(1),
    mdxMs: timings.mdx?.toFixed(1),
    esbuildMs: timings.esbuild?.toFixed(1),
    rewriteMs: timings.rewrite?.toFixed(1),
  });

  return code;
}
