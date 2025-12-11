import { rendererLogger as logger } from "@veryfront/utils";
import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import React from "react";
import { getCacheNamespace } from "@veryfront/utils/cache/keys/namespace.ts";
import {
  getDefaultImportMap,
  transformImportsWithMap,
} from "@veryfront/modules/import-map/index.ts";
import type { MDXFrontmatter, MDXModule } from "./types.ts";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { isDeno, isNode } from "../../../platform/compat/runtime.ts";
import { cwd } from "../../../platform/compat/process.ts";

const IS_TRUE_NODE = isNode && !isDeno;

const LOG_PREFIX_MDX_LOADER = "[mdx-loader]";
const LOG_PREFIX_MDX_RENDERER = "[mdx-renderer]";
const JSX_IMPORT_PATTERN = /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+\.(jsx|tsx))['"];?/g;
const EXTENSIONLESS_FILE_IMPORT_PATTERN =
  /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+)['"];?/g;
const REACT_IMPORT_PATTERN = /import\s+.*React.*\s+from\s+['"]react['"]/;
const HTTP_IMPORT_PATTERN = /['"]https?:\/\/[^'"]+['"]/;
const ESBUILD_JSX_FACTORY = "React.createElement";
const ESBUILD_JSX_FRAGMENT = "React.Fragment";
const HTTP_MODULE_FETCH_TIMEOUT_MS = 30000;
const IMPORT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs"];

const PATH_ALIAS_PATTERN = /from\s+['"]@\/([^'"]+)['"]/g;

const _resolvedPaths: Record<string, string | null> = {};

async function resolveNodePackage(packageSpec: string): Promise<string | null> {
  if (!IS_TRUE_NODE) return null;
  if (packageSpec in _resolvedPaths) return _resolvedPaths[packageSpec]!;

  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const resolved = require.resolve(packageSpec);
    _resolvedPaths[packageSpec] = resolved;
    return resolved;
  } catch {
    _resolvedPaths[packageSpec] = null;
    return null;
  }
}

/**
 * Transform react imports to absolute file:// paths for Node.js.
 * This is needed because MDX modules are cached in arbitrary directories
 * (like temp dirs) where Node.js cannot resolve bare 'react' imports.
 */
async function transformReactImportsToAbsolute(code: string): Promise<string> {
  if (!IS_TRUE_NODE) return code;

  const reactPath = await resolveNodePackage("react");
  const reactJsxPath = await resolveNodePackage("react/jsx-runtime");
  const reactJsxDevPath = await resolveNodePackage("react/jsx-dev-runtime");
  const reactDomPath = await resolveNodePackage("react-dom");

  let result = code;

  if (reactJsxPath) {
    result = result.replace(
      /from\s+['"]react\/jsx-runtime['"]/g,
      `from "file://${reactJsxPath}"`,
    );
  }
  if (reactJsxDevPath) {
    result = result.replace(
      /from\s+['"]react\/jsx-dev-runtime['"]/g,
      `from "file://${reactJsxDevPath}"`,
    );
  }
  if (reactDomPath) {
    result = result.replace(
      /from\s+['"]react-dom['"]/g,
      `from "file://${reactDomPath}"`,
    );
  }
  if (reactPath) {
    result = result.replace(
      /from\s+['"]react['"]/g,
      `from "file://${reactPath}"`,
    );
  }

  return result;
}

async function resolveNestedImports(
  code: string,
  projectDir: string,
  cacheDir: string,
  // deno-lint-ignore no-explicit-any
  adapter: any,
  // deno-lint-ignore no-explicit-any
  localAdapter: any,
  cachedPaths: Map<string, string> = new Map(),
): Promise<string> {
  const { transform } = await import("esbuild/mod.js");

  let result = code;

  PATH_ALIAS_PATTERN.lastIndex = 0;
  result = result.replace(PATH_ALIAS_PATTERN, (_match, importPath) => {
    return `from "file://${projectDir}/${importPath}"`;
  });

  const importRegex = /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+)['"]/g;
  const imports: Array<{ fullMatch: string; importClause: string; filePath: string }> = [];

  let match;
  while ((match = importRegex.exec(result)) !== null) {
    const [fullMatch, importClause, filePath] = match;
    if (!filePath) continue;
    if (IMPORT_EXTENSIONS.some((ext) => filePath.endsWith(ext))) continue;
    if (!isProjectFilePath(filePath, projectDir)) continue;

    imports.push({ fullMatch, importClause, filePath });
  }

  for (const { fullMatch, importClause, filePath } of imports) {
    const existingCachePath = cachedPaths.get(filePath);
    if (existingCachePath) {
      result = result.replace(
        fullMatch,
        `import ${importClause} from "file://${existingCachePath}"`,
      );
      logger.info(`${LOG_PREFIX_MDX_LOADER} [nested] Using cached: ${filePath} -> ${existingCachePath}`);
      continue;
    }

    const cacheFileName = `nested-${hashString(filePath)}.mjs`;
    const cachePath = join(cacheDir, cacheFileName);

    cachedPaths.set(filePath, cachePath);

    try {
      const resolved = await resolveFileWithExtension(filePath, projectDir, adapter);
      if (!resolved) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} [nested] Could not resolve: ${filePath}`);
        cachedPaths.delete(filePath);
        continue;
      }

      const { extension, content } = resolved;
      let transformedContent: string;

      if (extension === ".tsx" || extension === ".jsx") {
        const esbuildResult = await transform(content, {
          loader: extension === ".tsx" ? "tsx" : "jsx",
          jsx: "transform",
          jsxFactory: ESBUILD_JSX_FACTORY,
          jsxFragment: ESBUILD_JSX_FRAGMENT,
          format: "esm",
        });

        transformedContent = esbuildResult.code;

        if (!REACT_IMPORT_PATTERN.test(transformedContent)) {
          transformedContent = `import React from 'react';\n${transformedContent}`;
        }
      } else if (extension === ".ts") {
        const esbuildResult = await transform(content, {
          loader: "ts",
          format: "esm",
        });
        transformedContent = esbuildResult.code;
      } else {
        transformedContent = content;
      }

      transformedContent = await resolveNestedImports(
        transformedContent,
        projectDir,
        cacheDir,
        adapter,
        localAdapter,
        cachedPaths,
      );

      if (!IS_TRUE_NODE) {
        transformedContent = transformImportsWithMap(
          transformedContent,
          getDefaultImportMap(),
          undefined,
          { resolveBare: true },
        );
      }

      await localAdapter.fs.writeFile(cachePath, transformedContent);

      result = result.replace(
        fullMatch,
        `import ${importClause} from "file://${cachePath}"`,
      );

      logger.info(`${LOG_PREFIX_MDX_LOADER} [nested] Resolved: ${filePath} -> ${cachePath}`);
    } catch (error) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} [nested] Failed to resolve: ${filePath}`, error);
      cachedPaths.delete(filePath);
    }
  }

  return result;
}

function transformPathAliasImports(code: string, projectDir: string): string {
  PATH_ALIAS_PATTERN.lastIndex = 0;

  return code.replace(PATH_ALIAS_PATTERN, (_match, importPath) => {
    return `from "file://${projectDir}/${importPath}"`;
  });
}

async function resolveFileWithExtension(
  basePath: string,
  projectDir: string,
  // deno-lint-ignore no-explicit-any
  adapter: any,
): Promise<{ resolvedPath: string; extension: string; content: string } | null> {
  const relativePath = basePath.startsWith(projectDir)
    ? basePath.slice(projectDir.length).replace(/^\
    : basePath;

  logger.info(`${LOG_PREFIX_MDX_LOADER} Trying to resolve extensionless: base=${basePath}, rel=${relativePath}`);

  for (const ext of IMPORT_EXTENSIONS) {
    const pathWithExt = `${relativePath}${ext}`;
    try {
      logger.info(`${LOG_PREFIX_MDX_LOADER} Trying extension: ${pathWithExt}`);
      const content = await adapter.fs.readFile(pathWithExt);
      if (content) {
        logger.info(`${LOG_PREFIX_MDX_LOADER} Resolved extensionless import: ${basePath} -> ${pathWithExt}`);
        return {
          resolvedPath: `${basePath}${ext}`,
          extension: ext,
          content: content as string,
        };
      }
    } catch (err) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Extension ${ext} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}

function isProjectFilePath(filePath: string, projectDir: string): boolean {
  return filePath.startsWith(projectDir) || filePath.startsWith("/");
}

export interface ESMLoaderContext {
  esmCacheDir?: string;
  moduleCache: LRUCache<string, MDXModule>;
}

export function hashString(input: string): string {
  const HASH_SEED_FNV1A = 2166136261;
  let hash = HASH_SEED_FNV1A >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function createHTTPPluginForMDX(): import("esbuild").Plugin {
  return {
    name: "vf-mdx-http-fetch",
    setup(build) {
      build.onResolve({ filter: /^(http|https):\/\
        path: args.path,
        namespace: "http-url",
      }));

      build.onResolve({ filter: /.*/, namespace: "http-url" }, (args) => {
        if (args.path.startsWith("http://") || args.path.startsWith("https://")) {
          return { path: args.path, namespace: "http-url" };
        }
        try {
          const resolved = new URL(args.path, args.importer).toString();
          return { path: resolved, namespace: "http-url" };
        } catch {
          return undefined;
        }
      });

      build.onLoad({ filter: /.*/, namespace: "http-url" }, async (args) => {
        let requestUrl = args.path;
        try {
          const u = new URL(args.path);
          if (u.hostname === "esm.sh") {
            if (u.pathname.includes("/denonext/")) {
              u.pathname = u.pathname.replace("/denonext/", "/");
            }
            u.searchParams.set("target", "es2020");
            u.searchParams.set("bundle", "true");
            requestUrl = u.toString();
          }
        } catch {
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HTTP_MODULE_FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(requestUrl, {
            headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (!res.ok) {
            return {
              errors: [{ text: `Failed to fetch ${args.path}: ${res.status}` }],
            };
          }

          const text = await res.text();
          return { contents: text, loader: "js" };
        } catch (e) {
          clearTimeout(timeout);
          return {
            errors: [{
              text: `Failed to fetch ${args.path}: ${e instanceof Error ? e.message : String(e)}`,
            }],
          };
        }
      });
    },
  };
}

export async function loadModuleESM(
  compiledProgramCode: string,
  context: ESMLoaderContext,
): Promise<MDXModule> {
  try {
    const { runtime } = await import("@veryfront/platform/adapters/registry.ts");
    const adapter = await runtime.get();

    const localAdapter = await runtime.getLocal();

    if (!context.esmCacheDir) {
      if (IS_TRUE_NODE) {
        const projectCacheDir = join(
          cwd(),
          "node_modules",
          ".cache",
          "veryfront-mdx",
        );
        await localAdapter.fs.mkdir(projectCacheDir, { recursive: true });
        context.esmCacheDir = projectCacheDir;
      } else {
        context.esmCacheDir = await localAdapter.fs.makeTempDir({ prefix: "veryfront-mdx-esm-" });
      }
    }

    let rewritten: string;
    if (IS_TRUE_NODE) {
      // This is needed because MDX modules are cached in temp directories
      rewritten = await transformReactImportsToAbsolute(compiledProgramCode);
    } else {
      rewritten = transformImportsWithMap(
        compiledProgramCode,
        getDefaultImportMap(),
        undefined,
        { resolveBare: true },
      );
    }

    let jsxMatch;
    const jsxTransforms: Array<{ original: string; transformed: string }> = [];

    const { transform } = await import("esbuild/mod.js");

    while ((jsxMatch = JSX_IMPORT_PATTERN.exec(rewritten)) !== null) {
      const [fullMatch, importClause, filePath, ext] = jsxMatch;

      if (!filePath) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Skipping JSX import with undefined file path`, {
          fullMatch,
        });
        continue;
      }

      try {
        const jsxCode = await adapter.fs.readFile(filePath);

        const result = await transform(jsxCode as string, {
          loader: ext === "tsx" ? "tsx" : "jsx",
          jsx: "transform",
          jsxFactory: ESBUILD_JSX_FACTORY,
          jsxFragment: ESBUILD_JSX_FRAGMENT,
          format: "esm",
        });

        let transformed = result.code;

        if (!REACT_IMPORT_PATTERN.test(transformed)) {
          transformed = `import React from 'react';\n${transformed}`;
        }

        const projectDir = cwd();
        transformed = await resolveNestedImports(
          transformed,
          projectDir,
          context.esmCacheDir!,
          adapter,
          localAdapter,
        );

        if (!IS_TRUE_NODE) {
          transformed = transformImportsWithMap(
            transformed,
            getDefaultImportMap(),
            undefined,
            { resolveBare: true },
          );
        }

        const transformedFileName = `jsx-${hashString(filePath)}.mjs`;
        const transformedPath = join(context.esmCacheDir!, transformedFileName);
        await localAdapter.fs.writeFile(transformedPath, transformed);

        jsxTransforms.push({
          original: fullMatch,
          transformed: `import ${importClause} from "file://${transformedPath}";`,
        });

        logger.info(
          `${LOG_PREFIX_MDX_LOADER} Transformed JSX import using esbuild: ${filePath} -> ${transformedPath}`,
        );
      } catch (error) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform JSX import: ${filePath}`, error);
      }
    }

    for (const { original, transformed } of jsxTransforms) {
      rewritten = rewritten.replace(original, transformed);
    }

    let extMatch;
    const extTransforms: Array<{ original: string; transformed: string }> = [];
    const processedPaths = new Set<string>();

    EXTENSIONLESS_FILE_IMPORT_PATTERN.lastIndex = 0;

    while ((extMatch = EXTENSIONLESS_FILE_IMPORT_PATTERN.exec(rewritten)) !== null) {
      const [fullMatch, importClause, filePath] = extMatch;

      if (!filePath) continue;

      if (IMPORT_EXTENSIONS.some((ext) => filePath.endsWith(ext))) continue;

      if (processedPaths.has(filePath)) continue;
      processedPaths.add(filePath);

      const projectDir = cwd();
      if (!isProjectFilePath(filePath, projectDir)) continue;

      logger.info(`${LOG_PREFIX_MDX_LOADER} Found extensionless import: ${filePath}`);

      try {
        const resolved = await resolveFileWithExtension(filePath, projectDir, adapter);
        if (!resolved) {
          logger.warn(`${LOG_PREFIX_MDX_LOADER} Could not resolve extension for: ${filePath}`);
          continue;
        }

        const { extension, content } = resolved;

        if (extension === ".tsx" || extension === ".jsx") {
          const result = await transform(content, {
            loader: extension === ".tsx" ? "tsx" : "jsx",
            jsx: "transform",
            jsxFactory: ESBUILD_JSX_FACTORY,
            jsxFragment: ESBUILD_JSX_FRAGMENT,
            format: "esm",
          });

          let transformedCode = result.code;

          if (!REACT_IMPORT_PATTERN.test(transformedCode)) {
            transformedCode = `import React from 'react';\n${transformedCode}`;
          }

          transformedCode = await resolveNestedImports(
            transformedCode,
            projectDir,
            context.esmCacheDir!,
            adapter,
            localAdapter,
          );

          if (!IS_TRUE_NODE) {
            transformedCode = transformImportsWithMap(
              transformedCode,
              getDefaultImportMap(),
              undefined,
              { resolveBare: true },
            );
          }

          const transformedFileName = `resolved-${hashString(filePath)}.mjs`;
          const transformedPath = join(context.esmCacheDir!, transformedFileName);
          await localAdapter.fs.writeFile(transformedPath, transformedCode);

          extTransforms.push({
            original: fullMatch,
            transformed: `import ${importClause} from "file://${transformedPath}";`,
          });

          logger.info(
            `${LOG_PREFIX_MDX_LOADER} Resolved and transformed extensionless import: ${filePath} -> ${transformedPath}`,
          );
        } else {
          const resolvedFileName = `resolved-${hashString(filePath)}.mjs`;
          const resolvedPath = join(context.esmCacheDir!, resolvedFileName);

          let transformedCode: string;

          if (extension === ".ts") {
            const result = await transform(content, {
              loader: "ts",
              format: "esm",
            });
            transformedCode = result.code;
          } else {
            transformedCode = content;
          }

          transformedCode = await resolveNestedImports(
            transformedCode,
            projectDir,
            context.esmCacheDir!,
            adapter,
            localAdapter,
          );

          if (!IS_TRUE_NODE) {
            transformedCode = transformImportsWithMap(
              transformedCode,
              getDefaultImportMap(),
              undefined,
              { resolveBare: true },
            );
          }

          await localAdapter.fs.writeFile(resolvedPath, transformedCode);

          extTransforms.push({
            original: fullMatch,
            transformed: `import ${importClause} from "file://${resolvedPath}";`,
          });

          logger.info(
            `${LOG_PREFIX_MDX_LOADER} Resolved extensionless import: ${filePath} -> ${resolvedPath}`,
          );
        }
      } catch (error) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to resolve extensionless import: ${filePath}`, error);
      }
    }

    for (const { original, transformed } of extTransforms) {
      rewritten = rewritten.replace(original, transformed);
    }

    if (/\bconst\s+MDXLayout\b/.test(rewritten) && !/export\s+\{[^}]*MDXLayout/.test(rewritten)) {
      rewritten += "\nexport { MDXLayout as __vfLayout };\n";
    }

    if (IS_TRUE_NODE && HTTP_IMPORT_PATTERN.test(rewritten)) {
      logger.info(`${LOG_PREFIX_MDX_LOADER} Bundling HTTP imports via esbuild for Node.js`);
      const { build } = await import("esbuild/mod.js");

      const tempSourcePath = join(context.esmCacheDir!, `temp-${hashString(rewritten)}.mjs`);
      await localAdapter.fs.writeFile(tempSourcePath, rewritten);

      try {
        const result = await build({
          entryPoints: [tempSourcePath],
          bundle: true,
          format: "esm",
          platform: "neutral",
          target: "es2020",
          write: false,
          plugins: [createHTTPPluginForMDX()],
          external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
        });

        const bundledCode = result.outputFiles?.[0]?.text;
        if (bundledCode) {
          rewritten = bundledCode;
          logger.info(`${LOG_PREFIX_MDX_LOADER} Successfully bundled HTTP imports`);
        }
      } catch (bundleError) {
        logger.warn(
          `${LOG_PREFIX_MDX_LOADER} Failed to bundle HTTP imports, falling back to original code`,
          bundleError,
        );
      } finally {
        try {
          // deno-lint-ignore no-explicit-any
          const fsAny = adapter.fs as any;
          if (typeof fsAny.rm === "function") {
            await fsAny.rm(tempSourcePath);
          } else if (typeof fsAny.unlink === "function") {
            await fsAny.unlink(tempSourcePath);
          }
        } catch {
        }
      }
    }

    const codeHash = hashString(rewritten);
    const namespace = getCacheNamespace() || "default";
    const compositeKey = `${namespace}:${codeHash}`;

    const cached = context.moduleCache.get(compositeKey);
    if (cached) return cached as MDXModule;

    const nsDir = join(context.esmCacheDir, namespace);
    try {
      await localAdapter.fs.mkdir(nsDir, { recursive: true });
    } catch (e) {
      logger.debug(
        `${LOG_PREFIX_MDX_RENDERER} mkdir nsDir failed`,
        e instanceof Error ? e : String(e),
      );
    }

    const filePath = join(nsDir, `${codeHash}.mjs`);
    try {
      const stat = await localAdapter.fs.stat(filePath);
      if (!stat?.isFile) {
        await localAdapter.fs.writeFile(filePath, rewritten);
      }
    } catch (error) {
      logger.debug(`${LOG_PREFIX_MDX_RENDERER} Writing temporary MDX module file:`, error);
      await localAdapter.fs.writeFile(filePath, rewritten);
    }

    logger.info(`${LOG_PREFIX_MDX_RENDERER} Loading MDX module`, {
      filePath,
      codePreview: rewritten.substring(0, 300),
    });
    const mod = await import(`file://${filePath}?v=${codeHash}`) as Record<string, unknown> & {
      __vfLayout?: React.ComponentType;
    };

    const result: MDXModule = {
      ...mod,
      default: mod?.default as React.ComponentType<unknown> | undefined,
      MDXContent: mod?.MDXContent as React.ComponentType<unknown> | undefined,
      frontmatter: mod?.frontmatter as MDXFrontmatter | undefined,
      headings: mod?.headings as Array<{ text: string; level: number }> | undefined,
      title: mod?.title as string | undefined,
      description: mod?.description as string | undefined,
      layout: mod?.layout as string | boolean | React.ComponentType | undefined,
      MDXLayout: (mod?.MDXLayout || mod?.__vfLayout) as React.ComponentType<unknown> | undefined,
      MainLayout: mod?.MainLayout as React.ComponentType<unknown> | undefined,
    };
    context.moduleCache.set(compositeKey, result);
    return result;
  } catch (error) {
    logger.error(`${LOG_PREFIX_MDX_RENDERER} MDX ESM load failed:`, error);
    throw error;
  }
}
