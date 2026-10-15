import {
  buildSourceModuleMetaBinding,
  getSourceModuleRuntimeUrl,
} from "#veryfront/transforms/shared/source-module-location.ts";
import { bindScriptModuleImports } from "./script-module-imports.ts";
import { isBuiltin } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isBun } from "#veryfront/platform/compat/runtime.ts";
import {
  getLocalReactPath,
  type LocalReactPeerSnapshot,
} from "#veryfront/platform/compat/react-paths.ts";
import type { CapturedDependencyConfiguration } from "#veryfront/transforms/esm/dependency-snapshot.ts";
/**
 * Script Page Handling (TS/JS files)
 *
 * Handles rendering of plain TS/JS script pages that return HTML or Response objects.
 * Supports both local file imports and remote file transpilation via esbuild.
 */

import { DEFAULT_DASHBOARD_PORT, rendererLogger } from "#veryfront/utils";
import { rewriteNpmImports } from "#veryfront/transforms/npm-import-rewrites.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createError, RENDER_ERROR, toError } from "#veryfront/errors";
import { flattenRouteParams } from "#veryfront/routing";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import type {
  ComponentProps,
  EntityInfo,
  MDXFrontmatter,
  PageContext,
  RenderResult,
  ScriptPageModule,
} from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { buildImportMapJson, type HTMLGenerationOptions, wrapInHTMLShell } from "#veryfront/html";
import { extractHTMLMetadata, injectHTMLContent, isFullHTMLDocument } from "#veryfront/html";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import {
  hasImmutableReleaseHydrationRuntime,
  resolveProdHydrationModulePath,
} from "#veryfront/html/hydration-script-builder/prod-runtime-selection.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { computeHash } from "./utils/index.ts";
import { getRuntimeModuleLoader } from "#veryfront/platform/adapters/module-loader.ts";

const logger = rendererLogger.component("script");
const SCRIPT_MODULE_CACHE_LIMIT = 256;
const scriptModules = new Map<string, { load: Promise<ScriptPageModule> }>();

type ScriptModuleOutput =
  | string
  | Response
  | { html: string; frontmatter?: MDXFrontmatter; meta?: MDXFrontmatter }
  | null;

interface ScriptPageOptions {
  mode: string;
  reactPeers?: LocalReactPeerSnapshot;
  config: VeryfrontConfig;
  projectDir: string;
  adapter: RuntimeAdapter;
  params?: Record<string, string | string[]>;
  url?: URL;
  props?: ComponentProps;
  nonce?: string;
  /** Release that owns the immutable hydration runtime for wrapped output. */
  releaseId?: string;
  /** Immutable dependency snapshot that owns all browser work for this document. */
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  dependencyPinningConfiguredVersions?: CapturedDependencyConfiguration;
}

const ESBUILD_EXTERNALS = [
  "zod",
  "node:*",
  "veryfront",
  "veryfront/*",
  "@opentelemetry/*",
];

const APP_COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"];

async function executeModuleRender(
  mod: ScriptPageModule,
  ctx: PageContext,
): Promise<ScriptModuleOutput> {
  if (typeof mod?.render === "function") return await mod.render(ctx);
  if (typeof mod?.default === "function") return await mod.default(ctx);
  if (typeof mod?.default === "string") return mod.default;
  if (typeof mod?.html === "string") return mod.html;

  throw toError(
    createError({
      type: "render",
      message:
        "Script page must export a 'render(ctx)' function, a default function, or a string HTML",
    }),
  );
}

async function collectModuleMetadata(
  mod: ScriptPageModule,
  ctx: PageContext,
): Promise<Record<string, unknown>> {
  if (typeof mod?.generateMetadata !== "function") return {};

  try {
    const generated = await mod.generateMetadata(ctx);
    return generated && typeof generated === "object" ? (generated as Record<string, unknown>) : {};
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    logger.warn("generateMetadata threw for TS/JS page", error);

    if (error instanceof ReferenceError || error instanceof SyntaxError) {
      throw error;
    }
    // Fallback for cross-realm errors where instanceof checks fail
    if (error.name === "ReferenceError" || error.name === "SyntaxError") {
      throw error;
    }
    return {};
  }
}

function extractHtmlAndMetadata(output: ScriptModuleOutput): {
  htmlBody: string;
  outputMetadata: Record<string, unknown>;
} {
  if (typeof output === "string") return { htmlBody: output, outputMetadata: {} };

  if (output && typeof output === "object" && "html" in output && typeof output.html === "string") {
    return {
      htmlBody: output.html,
      outputMetadata: output.frontmatter || output.meta || {},
    };
  }

  if (output && typeof output === "object") {
    // HTML-escape the serialized output: object values may contain user-controlled
    // strings with markup (e.g. "<script>"), which would otherwise be injected unescaped.
    return {
      htmlBody: `<pre>${escapeHtml(JSON.stringify(output, null, 2))}</pre>`,
      outputMetadata: {},
    };
  }

  throw toError(
    createError({
      type: "render",
      message: "Unsupported script page return type",
    }),
  );
}

function buildPageContext(
  pageInfo: EntityInfo,
  slug: string,
  params?: Record<string, string | string[]>,
  url?: URL,
): PageContext {
  const flatParams = flattenRouteParams(params);

  return {
    params: flatParams,
    query: url ? Object.fromEntries(url.searchParams) : {},
    slug,
    path: pageInfo.entity.path,
    frontmatter: pageInfo.entity.frontmatter || {},
  };
}

async function resolveAppComponentPath(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<string | undefined> {
  for (const ext of APP_COMPONENT_EXTENSIONS) {
    const candidate = join(projectDir, `components/app${ext}`);
    if (await adapter.fs.exists(candidate)) return candidate;
  }
  return undefined;
}

function getStringMeta(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  return typeof value === "string" ? value : undefined;
}

export async function handleScriptPage(
  pageInfo: EntityInfo,
  slug: string,
  options: ScriptPageOptions,
): Promise<RenderResult> {
  try {
    logger.debug(`Loading TS/JS page module: ${pageInfo.entity.path}`);

    const mod = await loadScriptModule(
      pageInfo.entity.path,
      options.projectDir,
      options.adapter,
      options.reactPeers,
      options.mode === "production"
        ? JSON.stringify([
          options.releaseId,
          options.dependencyPinningCacheKey,
          options.dependencyPinningDependencies,
          options.dependencyPinningConfiguredVersions,
        ])
        : undefined,
      options.config.build?.serverExternalPackages,
    );
    const ctx = buildPageContext(pageInfo, slug, options.params, options.url);

    let output = await executeModuleRender(mod, ctx);
    const generatedMetadata = await collectModuleMetadata(mod, ctx);

    if (output instanceof Response) output = await output.text();

    const { htmlBody, outputMetadata } = extractHtmlAndMetadata(output);

    const mergedFrontmatter = {
      ...pageInfo.entity.frontmatter,
      ...outputMetadata,
      ...generatedMetadata,
    } as MDXFrontmatter;

    const appComponentPath = await resolveAppComponentPath(options.projectDir, options.adapter);

    const fullHtml = await generateFullHtml(htmlBody, {
      mergedFrontmatter,
      outputMetadata,
      pageInfo,
      slug,
      appComponentPath,
      options,
    });

    const ssrHash = await computeHash(fullHtml);

    return {
      html: fullHtml,
      frontmatter: mergedFrontmatter,
      headings: [],
      nodeMap: undefined,
      stream: null,
      ssrHash,
    };
  } catch (error) {
    throw RENDER_ERROR.create({
      detail: `Failed to render TS/JS page: ${
        error instanceof Error ? error.message : String(error)
      }`,
      context: { slug, error },
    });
  }
}

async function generateFullHtml(
  htmlBody: string,
  context: {
    mergedFrontmatter: MDXFrontmatter;
    outputMetadata: Record<string, unknown>;
    pageInfo: EntityInfo;
    slug: string;
    appComponentPath: string | undefined;
    options: ScriptPageOptions;
  },
): Promise<string> {
  const { mergedFrontmatter, outputMetadata, pageInfo, slug, appComponentPath, options } = context;
  const hasEnabledDependencySnapshot =
    options.dependencyPinningCacheKey?.startsWith("on:") === true;
  const releaseHydrationModulePath = options.mode === "production" &&
      hasImmutableReleaseHydrationRuntime(options.releaseId)
    ? await resolveProdHydrationModulePath({
      fs: options.adapter.fs,
      projectDir: options.projectDir,
      buildOutDir: options.config.build?.outDir,
      releaseId: options.releaseId,
    })
    : undefined;

  if (isFullHTMLDocument(htmlBody)) {
    const metadata = extractHTMLMetadata(mergedFrontmatter, undefined);
    const importMapJson = hasEnabledDependencySnapshot || options.reactPeers !== undefined
      ? await buildImportMapJson({
        adapter: options.adapter,
        reactPeers: options.reactPeers,
        projectDir: options.projectDir,
        config: options.config,
        moduleServerOrigin: options.url?.origin,
        dependencyPinningCacheKey: options.dependencyPinningCacheKey,
        dependencyPinningDependencies: options.dependencyPinningDependencies,
        dependencyPinningConfiguredVersions: options.dependencyPinningConfiguredVersions,
      })
      : undefined;
    return injectHTMLContent(htmlBody, "", metadata, {
      mode: options.mode,
      slug,
      devPort: options.config?.dev?.port ?? DEFAULT_DASHBOARD_PORT,
      pagePath: pageInfo.entity.path,
      projectDir: options.projectDir,
      nonce: options.nonce,
      importMapJson,
      dependencyPinningCacheKey: options.dependencyPinningCacheKey,
      prodHydrationModulePath: releaseHydrationModulePath,
    });
  }

  const prodHydrationModulePath = releaseHydrationModulePath ??
    (options.mode === "production" ? getProdHydrationModulePath() : undefined);

  const htmlOptions: HTMLGenerationOptions = {
    adapter: options.adapter,
    reactPeers: options.reactPeers,
    mode: options.mode as "development" | "production",
    config: options.config,
    moduleServerOrigin: options.url?.origin,
    nestedLayouts: [],
    appPath: appComponentPath,
    nonce: options.nonce,
    releaseId: options.releaseId,
    prodHydrationModulePath,
    ...(hasEnabledDependencySnapshot
      ? {
        projectDir: options.projectDir,
        dependencyPinningCacheKey: options.dependencyPinningCacheKey,
        dependencyPinningDependencies: options.dependencyPinningDependencies,
        dependencyPinningConfiguredVersions: options.dependencyPinningConfiguredVersions,
      }
      : {}),
  };

  return wrapInHTMLShell(
    htmlBody,
    {
      title: getStringMeta(outputMetadata, "title") ??
        pageInfo.entity.frontmatter?.title ??
        "Veryfront App",
      description: getStringMeta(outputMetadata, "description") ??
        pageInfo.entity.frontmatter?.description ??
        "",
      slug,
      frontmatter: mergedFrontmatter,
      layoutFrontmatter: undefined,
      ssrHash: undefined,
    },
    htmlOptions,
    options.params,
    options.props,
  );
}

function normalizeModulePath(modulePath: string, projectDir: string): string {
  let normalized = modulePath;

  if (!normalized.startsWith("/") && projectDir) {
    normalized = join(projectDir, normalized);
  }

  if (!normalized.startsWith("/")) {
    normalized = join(cwd(), normalized);
  }

  return normalized;
}

function createFileUrl(path: string): string {
  const cacheBuster = `?v=${Date.now()}`;
  return path.startsWith("file://") ? `${path}${cacheBuster}` : `file://${path}${cacheBuster}`;
}

async function readFileWithFallback(
  adapter: RuntimeAdapter,
  modulePath: string,
  normalizedPath: string,
): Promise<string> {
  try {
    return await adapter.fs.readFile(modulePath);
  } catch (_) {
    /* expected: original path may not exist, try normalized path */
    try {
      return await adapter.fs.readFile(normalizedPath);
    } catch (_) {
      throw toError(
        createError({
          type: "file",
          message: `Script file not found: ${modulePath} (tried: ${normalizedPath})`,
          context: { path: modulePath },
        }),
      );
    }
  }
}

async function transpileWithEsbuild(
  source: string,
  modulePath: string,
  resolveDir: string,
  reactPeers?: LocalReactPeerSnapshot,
  serverExternalPackages?: readonly string[],
): Promise<string> {
  const { build, transform } = await import("veryfront/extensions/bundler");
  const loader = getEsbuildLoader(modulePath);
  const runtime = reactPeers ? await import(getSourceModuleRuntimeUrl()) : undefined;
  const sourceUrl = pathToFileURL(modulePath).href;
  if (runtime) await runtime.prepareSourceModuleMeta(sourceUrl, reactPeers);
  const conditions = runtime?.getSourceModuleConditions(sourceUrl);
  const preserveSourceUrl = async (contents: string, path: string) => {
    const sourceUrl = pathToFileURL(path).href;
    const meta = await buildSourceModuleMetaBinding(
      contents,
      sourceUrl,
      getSourceModuleRuntimeUrl(),
      reactPeers,
    );
    const transformed = await transform(contents, {
      loader: getEsbuildLoader(path),
      jsx: "preserve",
      target: "es2022",
      define: {
        "import.meta": meta.name,
        __dirname: JSON.stringify(dirname(path)),
        __filename: JSON.stringify(path),
      },
    });
    const bound = reactPeers
      ? await bindScriptModuleImports(
        transformed.code,
        path,
        reactPeers,
        getSourceModuleRuntimeUrl(),
      )
      : transformed.code;
    const code = bound.includes(meta.name)
      ? `${meta.banner}
${bound}`
      : bound;
    return code;
  };

  const result = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: reactPeers ? "node" : "neutral",
    mainFields: reactPeers ? (isBun ? ["module", "main"] : ["main"]) : undefined,
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "react",
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    external: reactPeers ? ["node:*"] : ESBUILD_EXTERNALS,
    conditions: reactPeers ? conditions ?? ["node", ...(isBun ? ["bun"] : [])] : undefined,
    plugins: reactPeers
      ? [{
        name: "captured-react-peers",
        setup(pluginBuild) {
          const externalResolution = Object.freeze({});
          pluginBuild.onResolve({ filter: /.*/ }, async (args) => {
            if (args.path === getSourceModuleRuntimeUrl()) {
              return { path: args.path, external: true };
            }
            if (isBuiltin(args.path)) {
              return {
                path: args.path.startsWith("node:") ? args.path : `node:${args.path}`,
                external: true,
              };
            }
            if (isBun && (args.path === "bun" || args.path.startsWith("bun:"))) {
              return { path: args.path, external: true };
            }
            const configured = !/^react(?:-dom)?(?:\/|$)/.test(args.path) &&
              serverExternalPackages?.some((name) =>
                args.path === name || args.path.startsWith(`${name}/`)
              );
            if (
              (configured || args.path.endsWith(".node")) && args.pluginData !== externalResolution
            ) {
              if (!pluginBuild.resolve) {
                throw new TypeError("Script bundler cannot resolve native dependencies");
              }
              const resolved = await pluginBuild.resolve(args.path, {
                importer: args.importer,
                resolveDir: args.resolveDir || resolveDir,
                kind: args.kind,
                pluginData: externalResolution,
              });
              if (resolved.errors?.length || !resolved.path) {
                return {
                  errors: resolved.errors?.length
                    ? resolved.errors
                    : [{ text: "Native script dependency is unavailable" }],
                };
              }
              return {
                path: args.kind === "require-call"
                  ? resolved.path
                  : pathToFileURL(resolved.path).href,
                external: true,
              };
            }
            return undefined;
          });
          pluginBuild.onLoad({ filter: /\.[cm]?[jt]sx?$/, namespace: "file" }, async (args) => ({
            contents: await preserveSourceUrl(
              await createFileSystem().readTextFile(args.path),
              args.path,
            ),
            loader: getEsbuildLoader(args.path),
            resolveDir: dirname(args.path),
          }));
          pluginBuild.onResolve({ filter: /^react(?:-dom)?(?:\/|$)/ }, (args) => {
            const path = getLocalReactPath(args.path, reactPeers.versions.react, reactPeers);
            if (!path) throw new TypeError("Captured React script import is unavailable");
            return {
              path: args.kind === "require-call" ? fileURLToPath(path) : path,
              external: true,
            };
          });
          pluginBuild.onResolve(
            { filter: /^(?:zod(?:\/|$)|veryfront(?:\/|$)|@opentelemetry\/)/ },
            async (args) => {
              if (args.pluginData === externalResolution) return undefined;
              if (!pluginBuild.resolve) {
                throw new TypeError("Script bundler cannot resolve project externals");
              }
              const resolved = await pluginBuild.resolve(args.path, {
                importer: args.importer,
                resolveDir: args.resolveDir || resolveDir,
                kind: args.kind,
                pluginData: externalResolution,
              });
              const errors = resolved.errors ?? [];
              if (errors.length > 0 || !resolved.path) {
                return {
                  errors: errors.length
                    ? errors
                    : [{ text: "Script external import is unavailable" }],
                };
              }
              return {
                path: args.kind === "require-call"
                  ? resolved.path
                  : pathToFileURL(resolved.path).href,
                external: true,
              };
            },
          );
        },
      }]
      : [],
    stdin: {
      contents: reactPeers ? await preserveSourceUrl(source, modulePath) : source,
      loader,
      resolveDir,
      sourcefile: modulePath,
    },
  });

  const firstError = result.errors?.[0]?.text;
  if (firstError) {
    throw toError(
      createError({
        type: "render",
        message: `[Script] Build failed: ${firstError}`,
      }),
    );
  }

  const code = result.outputFiles?.[0]?.text ?? "export {}";
  if (!reactPeers) return code;
  // Only free native require references in the completed bundle are rewritten;
  // static dependencies were already bundled with the captured peer resolver.
  let requireName = "__vfScriptRequire";
  let createName = "__vfCreateScriptRequire";
  while (code.includes(requireName) || code.includes(createName)) {
    requireName += "_";
    createName += "_";
  }
  const rewritten = await transform(code, {
    loader: "js",
    format: "esm",
    target: "es2022",
    define: { require: requireName },
  });
  return `import { createRequire as ${createName} } from "node:module";
const ${requireName} = ${createName}(${JSON.stringify(pathToFileURL(modulePath).href)});
${rewritten.code}`;
}

async function importFromTempFile(
  fs: Awaited<ReturnType<typeof createFileSystem>>,
  code: string,
): Promise<ScriptPageModule> {
  const tempDir = await fs.makeTempDir({ prefix: "vf-script-" });
  const tempFile = join(tempDir, "module.mjs");

  await fs.writeTextFile(tempFile, code);

  try {
    return (await import(createFileUrl(tempFile))) as ScriptPageModule;
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

async function loadScriptModule(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  reactPeers?: LocalReactPeerSnapshot,
  productionIdentity?: string,
  serverExternalPackages?: readonly string[],
): Promise<ScriptPageModule> {
  const prepared = getRuntimeModuleLoader(adapter);
  if (prepared) {
    return await prepared.importModule({ kind: "source", path: modulePath }) as ScriptPageModule;
  }
  const fs = createFileSystem();
  const normalizedPath = normalizeModulePath(modulePath, projectDir);

  logger.debug(`Checking if file exists locally: ${normalizedPath}`);

  const local = await fs.exists(normalizedPath);
  if (local && !reactPeers) {
    logger.debug(`File exists locally, using direct import: ${normalizedPath}`);
    return (await import(createFileUrl(normalizedPath))) as ScriptPageModule;
  }

  logger.debug(`File not local, using adapter-based loading: ${modulePath}`);

  const source = local
    ? await fs.readTextFile(normalizedPath)
    : await readFileWithFallback(adapter, modulePath, normalizedPath);
  logger.debug(`Read ${source.length} bytes from adapter`);

  const resolveDir = dirname(normalizedPath) || projectDir;
  const transpiled = await transpileWithEsbuild(
    source,
    reactPeers ? normalizedPath : modulePath,
    resolveDir,
    reactPeers,
    serverExternalPackages,
  );
  logger.debug(`Transpiled ${modulePath}`);

  const code = rewriteNpmImports(transpiled, projectDir);
  if (!reactPeers || productionIdentity === undefined) return importFromTempFile(fs, code);
  const key = await computeHash(
    JSON.stringify([normalizedPath, productionIdentity, reactPeers, code]),
  );
  const cached = scriptModules.get(key);
  if (cached) {
    scriptModules.delete(key);
    scriptModules.set(key, cached);
    return await cached.load;
  }
  const pending = { load: importFromTempFile(fs, code) };
  scriptModules.set(key, pending);
  while (scriptModules.size > SCRIPT_MODULE_CACHE_LIMIT) {
    const oldest = scriptModules.keys().next().value;
    if (oldest !== undefined) scriptModules.delete(oldest);
  }
  try {
    return await pending.load;
  } catch (error) {
    if (scriptModules.get(key) === pending) scriptModules.delete(key);
    throw error;
  }
}
