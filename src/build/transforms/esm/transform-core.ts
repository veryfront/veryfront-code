import * as esbuild from "esbuild";
import { generateCacheKey, getCachedTransform, setCachedTransform } from "./transform-cache.ts";
import { computeContentHash, getLoaderFromPath } from "./transform-utils.ts";
import { addDepsToEsmShUrls, resolveReactImports, isNodeRuntime } from "./react-imports.ts";
import {
  resolvePathAliases,
  resolveRelativeImports,
  resolveRelativeImportsToAbsolute,
  resolveRelativeImportsForNodeSSR,
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

  // If this is an MDX file, compile it to JSX first
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

  let code = result.code;

  code = await resolveReactImports(code);
  code = await addDepsToEsmShUrls(code);
  code = await resolvePathAliases(code, filePath, projectDir);

  // Different import resolution strategies for SSR vs browser
  if (ssr) {
    if (isNodeRuntime()) {
      // Node.js SSR: Keep relative imports but convert .tsx/.ts/.jsx extensions to .js
      // This works because the cache directory mirrors the project structure
      code = await resolveRelativeImportsForNodeSSR(code);
    } else {
      // Deno SSR: Convert relative imports to absolute file:// URLs pointing to original source files
      // This allows Deno to resolve them correctly even though the transformed file is in temp directory
      code = await resolveRelativeImportsToAbsolute(code, filePath, projectDir);
    }
  } else {
    // Browser: Rewrite imports to use module server (HTTP paths)
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