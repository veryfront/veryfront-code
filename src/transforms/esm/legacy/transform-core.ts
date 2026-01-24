import * as esbuild from "esbuild"; // Use native esbuild, not WASM
import { generateCacheKey, getCachedTransform, setCachedTransform } from "../transform-cache.ts";
import { computeShortContentHash, getLoaderFromPath } from "../transform-utils.ts";
import { addDepsToEsmShUrls, resolveReactImports } from "../react-imports.ts";
import {
  blockExternalUrlImports,
  resolveCrossProjectImports,
  resolvePathAliases,
  resolveRelativeImports,
  resolveRelativeImportsForSSR,
  resolveVeryfrontImports,
} from "../path-resolver.ts";
import { rewriteBareImports, rewriteVendorImports } from "../import-rewriter.ts";
import { bundleHttpImports } from "../http-bundler.ts";
import type { TransformOptions } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { compileMDXRuntime } from "../../mdx/compiler/mdx-compiler.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import {
  getDefaultImportMap,
  transformImportsWithMap,
} from "#veryfront/modules/import-map/index.ts";
import { getApiBaseUrlEnv } from "#veryfront/config/env.ts";

export async function transformToESM(
  source: string,
  filePath: string,
  projectDir: string,
  _adapter: RuntimeAdapter,
  options: TransformOptions,
): Promise<string> {
  const transformStart = performance.now();
  const timings: Record<string, number> = {};

  const { dev = true, jsxImportSource = "react", moduleServerUrl, vendorBundleHash, ssr = false } =
    options;

  const hashStart = performance.now();
  const contentHash = await computeShortContentHash(source);
  timings.hash = performance.now() - hashStart;

  const cacheKey = generateCacheKey(filePath, contentHash, ssr);
  const cached = getCachedTransform(cacheKey);
  if (cached) return cached.code;

  let transformSource = source;
  const isMdx = filePath.endsWith(".mdx");

  if (isMdx) {
    const mdxStart = performance.now();
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
    const sourcePreview = transformSource
      .split("\n")
      .slice(0, 10)
      .map((line, i) => `${String(i + 1).padStart(3, " ")}| ${line}`)
      .join("\n");

    logger.error("[ESM-TRANSFORM] Transform failed", {
      filePath,
      loader,
      sourceLength: transformSource.length,
      isMdx,
      error: transformError instanceof Error ? transformError.message : String(transformError),
    });
    logger.error("[ESM-TRANSFORM] Source preview (first 10 lines):\n" + sourcePreview);

    const errorMsg = transformError instanceof Error
      ? transformError.message
      : String(transformError);
    throw new Error(`ESM transform failed for ${filePath} (loader: ${loader}): ${errorMsg}`);
  }
  timings.esbuild = performance.now() - esbuildStart;

  const rewriteStart = performance.now();
  let code = result.code;

  if (dev && !ssr) {
    code = code.replace(
      /(['"])https?:\/\/[a-zA-Z0-9-]+\.(?:com|org|net|io|dev|app|veryfront\.com)\1/g,
      "location.origin",
    );
  }

  code = await resolveReactImports(code, ssr);
  code = await addDepsToEsmShUrls(code, ssr);
  code = await resolvePathAliases(code, filePath, projectDir, ssr);

  const apiBaseUrl = options.apiBaseUrl ?? getApiBaseUrlEnv();
  code = await resolveCrossProjectImports(code, { apiBaseUrl, ssr });

  if (ssr) {
    const urlBlockResult = await blockExternalUrlImports(code, filePath);
    code = urlBlockResult.code;

    if (urlBlockResult.blockedUrls.length > 0) {
      logger.warn("[ESM-TRANSFORM] Blocked external URL imports in SSR mode", {
        file: filePath.slice(-60),
        blockedUrls: urlBlockResult.blockedUrls,
      });
    }

    code = await resolveRelativeImportsForSSR(code);
    code = await resolveVeryfrontImports(code);

    code = transformImportsWithMap(code, getDefaultImportMap(), undefined, { resolveBare: true });
    code = bundleHttpImports(code, getHttpBundleCacheDir(), contentHash);

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

  code = await resolveRelativeImports(code, filePath, projectDir, moduleServerUrl);

  if (moduleServerUrl && vendorBundleHash) {
    code = await rewriteVendorImports(code, moduleServerUrl, vendorBundleHash);
  } else {
    code = await rewriteBareImports(code, moduleServerUrl);
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
