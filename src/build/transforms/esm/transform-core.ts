import * as esbuild from "esbuild";
import { generateCacheKey, getCachedTransform, setCachedTransform } from "./transform-cache.ts";
import { computeContentHash, getLoaderFromPath } from "./transform-utils.ts";
import { addDepsToEsmShUrls, resolveReactImports } from "./react-imports.ts";
import {
  resolvePathAliases,
  resolveRelativeImports,
  resolveRelativeImportsForSSR,
  resolveVeryfrontImports,
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
  const {
    dev = true,
    projectId,
    jsxImportSource = "react",
    moduleServerUrl,
    vendorBundleHash,
    ssr = false,
  } = options;

  const contentHash = await computeContentHash(source);
  const cacheKey = generateCacheKey(projectId, filePath, contentHash, ssr);

  const cached = getCachedTransform(cacheKey);
  if (cached) {
    return cached.code;
  }

  let transformSource = source;
  if (filePath.endsWith(".mdx")) {
    const mdxResult = await compileMDXRuntime(
      dev ? "development" : "production",
      projectDir,
      source,
      undefined,
      filePath,
      "browser",
      moduleServerUrl,
    );
    transformSource = mdxResult.compiledCode;
    logger.debug("[MDX-TRANSFORM] Compiled MDX for", filePath);
    logger.debug("[MDX-TRANSFORM] First 500 chars:", transformSource.substring(0, 500));
  }

  const loader = getLoaderFromPath(filePath);
  logger.debug("[TRANSFORM] esbuild transform starting", {
    filePath,
    loader,
    sourcePreview: transformSource.substring(0, 200),
    sourceLength: transformSource.length,
  });

  const result = await esbuild.transform(transformSource, {
    loader,
    format: "esm",
    target: "es2020",
    jsx: "automatic",
    jsxImportSource,
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    treeShaking: !dev,
    keepNames: true,
  });

  let code = result.code;

  code = await resolveReactImports(code, ssr);
  code = await addDepsToEsmShUrls(code);
  code = await resolvePathAliases(code, filePath, projectDir);

  if (ssr) {
    code = await resolveRelativeImportsForSSR(code);
    // Rewrite @veryfront