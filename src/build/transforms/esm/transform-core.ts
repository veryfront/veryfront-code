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
import { extractFrontmatter } from "../mdx/compiler/frontmatter-extractor.ts";
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
  } else if (filePath.endsWith(".tsx") || filePath.endsWith(".ts") || filePath.endsWith(".jsx")) {
    // Strip frontmatter from TSX/TS/JSX files if present
    logger.info("[ESM-TRANSFORM] Processing TSX/TS/JSX file:", filePath, "starts with ---:", source.trim().startsWith("---"));
    if (source.trim().startsWith("---")) {
      const { body } = await extractFrontmatter(source);
      transformSource = body;
      logger.info("[ESM-TRANSFORM] Stripped frontmatter from", filePath);
    }
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
  // For SSR, use absolute file:// paths to project dir since modules are cached in temp directories
  code = await resolvePathAliases(code, filePath, projectDir, moduleServerUrl, ssr);

  if (ssr) {
    code = await resolveRelativeImportsForSSR(code);
    code = await resolveVeryfrontImports(code);
  } else {
    code = await resolveRelativeImports(code, filePath, projectDir, moduleServerUrl);

    if (moduleServerUrl && vendorBundleHash) {
      code = await rewriteVendorImports(code, moduleServerUrl, vendorBundleHash);
    } else {
      code = await rewriteBareImports(code, moduleServerUrl);
    }
  }

  setCachedTransform(cacheKey, code, contentHash);

  return code;
}
