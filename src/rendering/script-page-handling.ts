/**
 * Script Page Handling (TS/JS files)
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { dirname, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { ErrorCode, VeryfrontError } from "#veryfront/errors/index.ts";
import { createError, toError } from "../errors/veryfront-error.ts";
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
import { DEFAULT_DASHBOARD_PORT } from "#veryfront/utils";
import { getContentHash } from "./utils/index.ts";
import { type HTMLGenerationOptions, wrapInHTMLShell } from "#veryfront/html";
import { extractHTMLMetadata, injectHTMLContent, isFullHTMLDocument } from "#veryfront/html";
import { createFileSystem } from "../platform/compat/fs.ts";
import { getEsbuildLoader } from "../utils/path-utils.ts";

/**
 * Handle plain TS/JS script pages - no React required
 */
export async function handleScriptPage(
  pageInfo: EntityInfo,
  slug: string,
  options: {
    mode: string;
    config: VeryfrontConfig;
    projectDir: string;
    adapter: RuntimeAdapter;
    params?: Record<string, string | string[]>;
    props?: ComponentProps;
    nonce?: string;
  },
): Promise<RenderResult> {
  try {
    logger.debug(`[Script] Loading TS/JS page module: ${pageInfo.entity.path}`);

    // Load the module - check if file exists locally first
    const mod = await loadScriptModule(pageInfo.entity.path, options.projectDir, options.adapter);

    // Build a minimal context
    const ctx: PageContext = {
      params: options.params
        ? (Object.fromEntries(
          Object.entries(options.params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
        ) as Record<string, string>)
        : {},
      slug,
      path: pageInfo.entity.path,
      frontmatter: pageInfo.entity.frontmatter || {},
    };

    let output:
      | string
      | Response
      | {
        html: string;
        frontmatter?: MDXFrontmatter;
        meta?: MDXFrontmatter;
      }
      | null = null;
    if (typeof mod?.render === "function") {
      output = await mod.render(ctx);
    } else if (typeof mod?.default === "function") {
      output = await mod.default(ctx);
    } else if (typeof mod?.default === "string") {
      output = mod.default;
    } else if (typeof mod?.html === "string") {
      output = mod.html;
    } else {
      throw toError(createError({
        type: "render",
        message:
          "Script page must export a 'render(ctx)' function, a default function, or a string HTML",
      }));
    }

    // Unwrap Response if returned
    if (output instanceof Response) {
      output = await output.text();
    }

    let htmlBody: string;
    let metaFromScript: Record<string, unknown> = {};
    let collectedMetadata: Record<string, unknown> = {};

    // Allow optional generateMetadata(ctx)
    try {
      if (typeof mod?.generateMetadata === "function") {
        const gen = await mod.generateMetadata(ctx);
        if (gen && typeof gen === "object") {
          collectedMetadata = {
            ...collectedMetadata,
            ...(gen as Record<string, unknown>),
          };
          metaFromScript = {
            ...metaFromScript,
            ...(gen as Record<string, unknown>),
          };
        }
      }
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      logger.warn("generateMetadata threw for TS/JS page", error);
      // Re-throw if this was a critical error (not just missing metadata)
      if (error.message.includes("ReferenceError") || error.message.includes("SyntaxError")) {
        throw error;
      }
    }

    if (typeof output === "string") {
      htmlBody = output;
    } else if (output && typeof output === "object" && typeof output.html === "string") {
      htmlBody = output.html;
      metaFromScript = output.frontmatter || output.meta || {};
    } else if (output && typeof output === "object") {
      // Handle non-HTML data returns (e.g., JSON API responses)
      // Wrap in a simple HTML structure for consistency
      htmlBody = `<pre>${JSON.stringify(output, null, 2)}</pre>`;
    } else {
      throw toError(createError({
        type: "render",
        message: "Unsupported script page return type",
      }));
    }

    // Always check for app component regardless of router type
    // The app component (components/app.mdx) provides providers like QueryClientProvider
    const appComponentPath = await resolveAppComponentPath(options.projectDir, options.adapter);

    const mergedFrontmatter = {
      ...pageInfo.entity.frontmatter,
      ...metaFromScript,
      ...collectedMetadata,
    } as MDXFrontmatter;

    // Decide full HTML
    let fullHtml: string;
    if (isFullHTMLDocument(htmlBody)) {
      const metadata = extractHTMLMetadata(mergedFrontmatter, undefined);
      fullHtml = injectHTMLContent(htmlBody, "", metadata, {
        mode: options.mode,
        slug,
        devPort: options.config?.dev?.port || DEFAULT_DASHBOARD_PORT,
      });
    } else {
      const htmlOptions: HTMLGenerationOptions = {
        mode: options.mode as "development" | "production",
        config: options.config,
        nestedLayouts: [],
        providerPaths: [],
        appPath: appComponentPath,
        nonce: options.nonce,
      };
      fullHtml = await wrapInHTMLShell(
        htmlBody,
        {
          title: (typeof metaFromScript.title === "string" ? metaFromScript.title : undefined) ||
            pageInfo.entity.frontmatter?.title ||
            "Veryfront App",
          description: (typeof metaFromScript.description === "string"
            ? metaFromScript.description
            : undefined) ||
            pageInfo.entity.frontmatter?.description ||
            "",
          slug,
          frontmatter: {
            ...mergedFrontmatter,
          },
          layoutFrontmatter: undefined,
          ssrHash: undefined,
        },
        htmlOptions,
        options.params,
        options.props,
      );
    }

    const ssrHash = await getContentHash(fullHtml);

    const result: RenderResult = {
      html: fullHtml,
      frontmatter: mergedFrontmatter,
      headings: [],
      nodeMap: undefined,
      stream: null,
      ssrHash,
    };

    return result;
  } catch (error) {
    throw new VeryfrontError(
      `Failed to render TS/JS page: ${error instanceof Error ? error.message : String(error)}`,
      ErrorCode.RENDER_ERROR,
      { slug, error },
    );
  }
}

async function resolveAppComponentPath(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<string | undefined> {
  // Check for app component in order of preference
  const extensions = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"];
  for (const ext of extensions) {
    const candidate = join(projectDir, `components/app${ext}`);
    if (await adapter.fs.exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Load a script module, handling both local and remote files.
 * For local files, uses direct import. For remote files (proxy mode),
 * reads via adapter and transpiles with esbuild.
 */
async function loadScriptModule(
  modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<ScriptPageModule> {
  const fs = createFileSystem();

  // Normalize path - ensure absolute path for file:// URLs
  let normalizedPath = modulePath;
  if (!modulePath.startsWith("/") && projectDir) {
    normalizedPath = join(projectDir, modulePath);
  }
  // Ensure absolute path (file:// URLs require absolute paths)
  if (!normalizedPath.startsWith("/")) {
    normalizedPath = join(cwd(), normalizedPath);
  }

  logger.debug(`[Script] Checking if file exists locally: ${normalizedPath}`);

  // Check if file exists on local filesystem
  const fileExistsLocally = await fs.exists(normalizedPath);

  if (fileExistsLocally) {
    // File exists locally - use direct import
    logger.debug(`[Script] File exists locally, using direct import: ${normalizedPath}`);
    const cacheBuster = `?v=${Date.now()}`;
    const url = normalizedPath.startsWith("file://")
      ? `${normalizedPath}${cacheBuster}`
      : `file://${normalizedPath}${cacheBuster}`;
    return await import(url) as ScriptPageModule;
  }

  // File is remote (proxy mode) - read via adapter and transpile
  logger.debug(`[Script] File not local, using adapter-based loading: ${modulePath}`);

  // Read file content via adapter (which handles API calls in proxy mode)
  let source: string;
  try {
    source = await adapter.fs.readFile(modulePath);
  } catch (_readError) {
    // Try with projectDir prefix
    try {
      source = await adapter.fs.readFile(normalizedPath);
    } catch {
      throw toError(createError({
        type: "file",
        message: `Script file not found: ${modulePath} (tried: ${normalizedPath})`,
        context: { path: modulePath },
      }));
    }
  }

  logger.debug(`[Script] Read ${source.length} bytes from adapter`);

  const loader = getEsbuildLoader(modulePath);

  // Transpile with esbuild
  const { build } = await import("esbuild");

  const resolveDir = dirname(normalizedPath) || projectDir;

  const result = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "react",
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    external: [
      "ai",
      "ai/*",
      "zod",
      "node:*",
      "veryfront",
      "veryfront/*",
      "@opentelemetry/*",
    ],
    stdin: {
      contents: source,
      loader,
      resolveDir,
      sourcefile: modulePath,
    },
  });

  if (result.errors && result.errors.length > 0) {
    const firstError = result.errors[0]?.text || "unknown error";
    throw toError(createError({
      type: "render",
      message: `[Script] Build failed: ${firstError}`,
    }));
  }

  logger.debug(`[Script] Transpiled ${modulePath}`);
  const js = result.outputFiles?.[0]?.text ?? "export {}";

  // Write to temp file and import
  const tempDir = await fs.makeTempDir({ prefix: "vf-script-" });
  const tempFile = join(tempDir, "module.mjs");

  // Rewrite npm imports for Deno compatibility
  let transformedCode = js;
  const isDeno = typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";
  if (isDeno) {
    const npmRewrites = [
      { pattern: /from\s+["']ai["']/g, replacement: 'from "npm:ai@latest"' },
      { pattern: /from\s+["']zod["']/g, replacement: 'from "npm:zod@latest"' },
    ];
    for (const { pattern, replacement } of npmRewrites) {
      transformedCode = transformedCode.replace(pattern, replacement);
    }
  }

  await fs.writeTextFile(tempFile, transformedCode);

  try {
    return await import(`file://${tempFile}?v=${Date.now()}`) as ScriptPageModule;
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}
