/**
 * Script Page Handling (TS/JS files)
 *
 * Handles rendering of plain TS/JS script pages that return HTML or Response objects.
 * Supports both local file imports and remote file transpilation via esbuild.
 */

import { DEFAULT_DASHBOARD_PORT, rendererLogger } from "#veryfront/utils";
import { rewriteNpmImports } from "#veryfront/transforms/npm-import-rewrites.ts";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  toFileUrl,
} from "#veryfront/compat/path/index.ts";
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
import { computeHash } from "./utils/index.ts";
import { type HTMLGenerationOptions, wrapInHTMLShell } from "#veryfront/html";
import { extractHTMLMetadata, injectHTMLContent, isFullHTMLDocument } from "#veryfront/html";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";

const logger = rendererLogger.component("script");

type ScriptModuleOutput =
  | string
  | Response
  | { html: string; frontmatter?: MDXFrontmatter; meta?: MDXFrontmatter }
  | null;

interface ScriptPageOptions {
  mode: "development" | "production";
  config: VeryfrontConfig;
  projectDir: string;
  adapter: RuntimeAdapter;
  params?: Record<string, string | string[]>;
  url?: URL;
  props?: ComponentProps;
  nonce?: string;
}

const ESBUILD_EXTERNALS = [
  "zod",
  "node:*",
  "veryfront",
  "veryfront/*",
  "@opentelemetry/*",
];

const APP_COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"];
const MAX_SCRIPT_SOURCE_BYTES = 5 * 1024 * 1024;

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

  const generated = await mod.generateMetadata(ctx);
  return generated && typeof generated === "object" ? (generated as Record<string, unknown>) : {};
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
    if (!await adapter.fs.exists(candidate)) continue;
    if (adapter.fs.lstat) {
      const info = await adapter.fs.lstat(candidate);
      if (!info.isFile || info.isSymlink) {
        throw new TypeError("Application component must be a regular file and not a symbolic link");
      }
    }
    if (adapter.fs.realPath) {
      const [canonicalPath, canonicalRoot] = await Promise.all([
        adapter.fs.realPath(candidate),
        adapter.fs.realPath(projectDir),
      ]);
      if (!isPathWithin(canonicalRoot, canonicalPath)) {
        throw new TypeError("Application component path is outside the project");
      }
    }
    return candidate;
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
    logger.debug("Loading script page module");

    const mod = await loadScriptModule(pageInfo.entity.path, options.projectDir, options.adapter);
    const ctx = buildPageContext(pageInfo, slug, options.params, options.url);

    let output = await executeModuleRender(mod, ctx);
    const generatedMetadata = await collectModuleMetadata(mod, ctx);

    if (output instanceof Response) {
      if (output.status < 200 || output.status >= 300) {
        throw new TypeError(
          `Script page returned status ${output.status}, which cannot be represented by RenderResult`,
        );
      }
      const contentType = output.headers.get("content-type");
      if (
        contentType && !contentType.startsWith("text/html") &&
        !contentType.startsWith("text/plain")
      ) {
        throw new TypeError("Script page Response must contain HTML or plain text");
      }
      const declaredLength = Number(output.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_SCRIPT_SOURCE_BYTES) {
        throw new RangeError("Script page Response exceeds the supported size");
      }
      output = await output.text();
    }

    const { htmlBody, outputMetadata } = extractHtmlAndMetadata(output);
    if (new TextEncoder().encode(htmlBody).byteLength > MAX_SCRIPT_SOURCE_BYTES) {
      throw new RangeError("Script page HTML exceeds the supported size");
    }

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
    const detail = sanitizeErrorText(
      error instanceof Error ? error.message : String(error),
      2_048,
    );
    throw RENDER_ERROR.create({
      detail: `Failed to render TS/JS page: ${detail}`,
      context: {
        slug,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
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

  if (isFullHTMLDocument(htmlBody)) {
    const metadata = extractHTMLMetadata(mergedFrontmatter, undefined);
    return injectHTMLContent(htmlBody, "", metadata, {
      mode: options.mode,
      slug,
      devPort: options.config?.dev?.port ?? DEFAULT_DASHBOARD_PORT,
      nonce: options.nonce,
    });
  }

  const htmlOptions: HTMLGenerationOptions = {
    mode: options.mode,
    config: options.config,
    nestedLayouts: [],
    appPath: appComponentPath,
    nonce: options.nonce,
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
  if (!projectDir.trim()) throw new TypeError("Script project directory must not be empty");
  if (!modulePath.trim() || modulePath.startsWith("file:")) {
    throw new TypeError("Script module path is invalid");
  }

  const projectRoot = resolve(projectDir);
  const normalized = isAbsolute(modulePath)
    ? resolve(modulePath)
    : resolve(projectRoot, modulePath);
  if (!isPathWithin(projectRoot, normalized)) {
    throw new TypeError("Script module path is outside the project");
  }
  return normalized;
}

function createFileUrl(path: string, version: string): string {
  const url = path.startsWith("file:") ? new URL(path) : toFileUrl(path);
  url.searchParams.set("v", version);
  return url.href;
}

async function readAdapterFile(
  adapter: RuntimeAdapter,
  normalizedPath: string,
): Promise<string> {
  try {
    return await adapter.fs.readFile(normalizedPath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    throw toError(
      createError({
        type: "file",
        message: "Script file was not found",
      }),
    );
  }
}

async function transpileWithEsbuild(
  source: string,
  modulePath: string,
  resolveDir: string,
): Promise<string> {
  if (new TextEncoder().encode(source).byteLength > MAX_SCRIPT_SOURCE_BYTES) {
    throw new RangeError("Script module source exceeds the supported size");
  }
  const { build } = await import("veryfront/extensions/bundler");
  const loader = getEsbuildLoader(modulePath);

  const result = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "react",
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    external: ESBUILD_EXTERNALS,
    stdin: {
      contents: source,
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

  return result.outputFiles?.[0]?.text ?? "export {}";
}

async function importFromTempFile(
  fs: Awaited<ReturnType<typeof createFileSystem>>,
  code: string,
): Promise<ScriptPageModule> {
  const tempDir = await fs.makeTempDir({ prefix: "vf-script-" });
  const tempFile = join(tempDir, "module.mjs");

  await fs.writeTextFile(tempFile, code);

  try {
    return (await import(createFileUrl(tempFile, await computeHash(code)))) as ScriptPageModule;
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

async function loadScriptModule(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<ScriptPageModule> {
  const fs = createFileSystem();
  const normalizedPath = normalizeModulePath(modulePath, projectDir);

  if (await fs.exists(normalizedPath)) {
    const info = fs.lstat ? await fs.lstat(normalizedPath) : await fs.stat(normalizedPath);
    if (!info.isFile || info.isSymlink) {
      throw new TypeError("Script module must be a regular file and cannot be a symbolic link");
    }
    if (info.size < 0 || info.size > MAX_SCRIPT_SOURCE_BYTES) {
      throw new RangeError("Script module source exceeds the supported size");
    }
    if (fs.realPath) {
      const [canonicalPath, canonicalRoot] = await Promise.all([
        fs.realPath(normalizedPath),
        fs.realPath(resolve(projectDir)),
      ]);
      if (!isPathWithin(canonicalRoot, canonicalPath)) {
        throw new TypeError("Script module path is outside the project");
      }
    }
    const version = `${info.mtime?.getTime() ?? 0}-${info.size}`;
    return (await import(createFileUrl(normalizedPath, version))) as ScriptPageModule;
  }

  await validateAdapterPath(adapter, normalizedPath, resolve(projectDir));
  const source = await readAdapterFile(adapter, normalizedPath);
  logger.debug("Read script source from runtime adapter", { sourceLength: source.length });

  const resolveDir = dirname(normalizedPath) || projectDir;
  const transpiled = await transpileWithEsbuild(source, modulePath, resolveDir);
  logger.debug("Transpiled script page module");

  return importFromTempFile(fs, rewriteNpmImports(transpiled));
}

async function validateAdapterPath(
  adapter: RuntimeAdapter,
  path: string,
  projectRoot: string,
): Promise<void> {
  if (adapter.fs.lstat) {
    try {
      const info = await adapter.fs.lstat(path);
      if (!info.isFile || info.isSymlink) {
        throw new TypeError("Script module must be a regular file and cannot be a symbolic link");
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  if (!adapter.fs.realPath) return;
  try {
    const [canonicalPath, canonicalRoot] = await Promise.all([
      adapter.fs.realPath(path),
      adapter.fs.realPath(projectRoot),
    ]);
    if (!isPathWithin(canonicalRoot, canonicalPath)) {
      throw new TypeError("Script module path is outside the project");
    }
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate).replaceAll("\\", "/");
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}
