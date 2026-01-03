import * as esbuild from "esbuild/mod.js"; // Use native esbuild, not WASM
import { generateCacheKey, getCachedTransform, setCachedTransform } from "./transform-cache.ts";
import { computeContentHash, getLoaderFromPath } from "./transform-utils.ts";
import { addDepsToEsmShUrls, resolveReactImports } from "./react-imports.ts";
import {
  resolvePathAliases,
  resolveRelativeImports,
  resolveRelativeImportsForSSR,
  resolveVeryfrontImports,
  blockExternalUrlImports,
} from "./path-resolver.ts";
import { rewriteBareImports, rewriteVendorImports } from "./import-rewriter.ts";
import type { TransformOptions } from "./types.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { compileMDXRuntime } from "../mdx/compiler/mdx-compiler.ts";
import { rendererLogger as logger } from "@veryfront/utils";

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
  const result = await esbuild.transform(transformSource, {
    loader: getLoaderFromPath(filePath),
    format: "esm",
    target: "es2020",
    jsx: "automatic",
    jsxImportSource,
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    treeShaking: !dev, // Disable in dev mode to preserve import errors
    keepNames: true,
  });
  timings.esbuild = performance.now() - esbuildStart;

  const rewriteStart = performance.now();
  let code = result.code;

  code = await resolveReactImports(code, ssr);
  code = await addDepsToEsmShUrls(code, ssr);
  code = await resolvePathAliases(code, filePath, projectDir, ssr);

  // Different import resolution strategies for SSR vs browser
  if (ssr) {
    // SSR: Block external URL imports (https://) that can't be loaded via file://
    // This prevents user code with CDN imports from crashing the renderer
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
  logger.info("[ESM-TRANSFORM] Timing breakdown", {
    file: filePath.slice(-40),
    totalMs: totalMs.toFixed(1),
    hashMs: timings.hash?.toFixed(1),
    mdxMs: timings.mdx?.toFixed(1),
    esbuildMs: timings.esbuild?.toFixed(1),
    rewriteMs: timings.rewrite?.toFixed(1),
  });

  return code;
}
