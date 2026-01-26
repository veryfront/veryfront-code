/**
 * Script Page Handling (TS/JS files)
 *
 * Handles rendering of plain TS/JS script pages that return HTML or Response objects.
 * Supports both local file imports and remote file transpilation via esbuild.
 */
import * as dntShim from "../../_dnt.shims.js";
import { DEFAULT_DASHBOARD_PORT, rendererLogger as logger } from "../utils/index.js";
import { dirname, join } from "../platform/compat/path/index.js";
import { cwd } from "../platform/compat/process.js";
import { ErrorCode, VeryfrontError } from "../errors/index.js";
import { createError, toError } from "../errors/veryfront-error.js";
import { computeHash } from "./utils/index.js";
import { wrapInHTMLShell } from "../html/index.js";
import { extractHTMLMetadata, injectHTMLContent, isFullHTMLDocument } from "../html/index.js";
import { createFileSystem } from "../platform/compat/fs.js";
import { getEsbuildLoader } from "../utils/path-utils.js";
const NPM_REWRITES = [
    { pattern: /from\s+["']ai["']/g, replacement: 'from "npm:ai@latest"' },
    { pattern: /from\s+["']zod["']/g, replacement: 'from "npm:zod@latest"' },
];
const ESBUILD_EXTERNALS = [
    "ai",
    "ai/*",
    "zod",
    "node:*",
    "veryfront",
    "veryfront/*",
    "@opentelemetry/*",
];
const APP_COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"];
async function executeModuleRender(mod, ctx) {
    if (typeof mod?.render === "function")
        return await mod.render(ctx);
    if (typeof mod?.default === "function")
        return await mod.default(ctx);
    if (typeof mod?.default === "string")
        return mod.default;
    if (typeof mod?.html === "string")
        return mod.html;
    throw toError(createError({
        type: "render",
        message: "Script page must export a 'render(ctx)' function, a default function, or a string HTML",
    }));
}
async function collectModuleMetadata(mod, ctx) {
    if (typeof mod?.generateMetadata !== "function")
        return {};
    try {
        const generated = await mod.generateMetadata(ctx);
        return generated && typeof generated === "object" ? generated : {};
    }
    catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        logger.warn("generateMetadata threw for TS/JS page", error);
        if (error.message.includes("ReferenceError") || error.message.includes("SyntaxError")) {
            throw error;
        }
        return {};
    }
}
function extractHtmlAndMetadata(output) {
    if (typeof output === "string")
        return { htmlBody: output, outputMetadata: {} };
    if (output && typeof output === "object" && "html" in output && typeof output.html === "string") {
        return {
            htmlBody: output.html,
            outputMetadata: output.frontmatter || output.meta || {},
        };
    }
    if (output && typeof output === "object") {
        return {
            htmlBody: `<pre>${JSON.stringify(output, null, 2)}</pre>`,
            outputMetadata: {},
        };
    }
    throw toError(createError({
        type: "render",
        message: "Unsupported script page return type",
    }));
}
function buildPageContext(pageInfo, slug, params) {
    const flatParams = params
        ? Object.fromEntries(Object.entries(params)
            .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
            .filter((entry) => entry[1] !== undefined))
        : {};
    return {
        params: flatParams,
        slug,
        path: pageInfo.entity.path,
        frontmatter: pageInfo.entity.frontmatter || {},
    };
}
async function resolveAppComponentPath(projectDir, adapter) {
    for (const ext of APP_COMPONENT_EXTENSIONS) {
        const candidate = join(projectDir, `components/app${ext}`);
        if (await adapter.fs.exists(candidate))
            return candidate;
    }
    return undefined;
}
function getStringMeta(meta, key) {
    const value = meta[key];
    return typeof value === "string" ? value : undefined;
}
export async function handleScriptPage(pageInfo, slug, options) {
    try {
        logger.debug(`[Script] Loading TS/JS page module: ${pageInfo.entity.path}`);
        const mod = await loadScriptModule(pageInfo.entity.path, options.projectDir, options.adapter);
        const ctx = buildPageContext(pageInfo, slug, options.params);
        let output = await executeModuleRender(mod, ctx);
        const generatedMetadata = await collectModuleMetadata(mod, ctx);
        if (output instanceof dntShim.Response)
            output = await output.text();
        const { htmlBody, outputMetadata } = extractHtmlAndMetadata(output);
        const mergedFrontmatter = {
            ...pageInfo.entity.frontmatter,
            ...outputMetadata,
            ...generatedMetadata,
        };
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
    }
    catch (error) {
        throw new VeryfrontError(`Failed to render TS/JS page: ${error instanceof Error ? error.message : String(error)}`, ErrorCode.RENDER_ERROR, { slug, error });
    }
}
async function generateFullHtml(htmlBody, context) {
    const { mergedFrontmatter, outputMetadata, pageInfo, slug, appComponentPath, options } = context;
    if (isFullHTMLDocument(htmlBody)) {
        const metadata = extractHTMLMetadata(mergedFrontmatter, undefined);
        return injectHTMLContent(htmlBody, "", metadata, {
            mode: options.mode,
            slug,
            devPort: options.config?.dev?.port || DEFAULT_DASHBOARD_PORT,
        });
    }
    const htmlOptions = {
        mode: options.mode,
        config: options.config,
        nestedLayouts: [],
        appPath: appComponentPath,
        nonce: options.nonce,
    };
    return await wrapInHTMLShell(htmlBody, {
        title: getStringMeta(outputMetadata, "title") ||
            pageInfo.entity.frontmatter?.title ||
            "Veryfront App",
        description: getStringMeta(outputMetadata, "description") ||
            pageInfo.entity.frontmatter?.description ||
            "",
        slug,
        frontmatter: mergedFrontmatter,
        layoutFrontmatter: undefined,
        ssrHash: undefined,
    }, htmlOptions, options.params, options.props);
}
function normalizeModulePath(modulePath, projectDir) {
    let normalized = modulePath;
    if (!modulePath.startsWith("/") && projectDir) {
        normalized = join(projectDir, modulePath);
    }
    if (!normalized.startsWith("/")) {
        normalized = join(cwd(), normalized);
    }
    return normalized;
}
function createFileUrl(path) {
    const cacheBuster = `?v=${Date.now()}`;
    return path.startsWith("file://") ? `${path}${cacheBuster}` : `file://${path}${cacheBuster}`;
}
async function readFileWithFallback(adapter, modulePath, normalizedPath) {
    try {
        return await adapter.fs.readFile(modulePath);
    }
    catch {
        try {
            return await adapter.fs.readFile(normalizedPath);
        }
        catch {
            throw toError(createError({
                type: "file",
                message: `Script file not found: ${modulePath} (tried: ${normalizedPath})`,
                context: { path: modulePath },
            }));
        }
    }
}
function rewriteNpmImports(code) {
    const isDeno = typeof dntShim.dntGlobalThis.Deno !== "undefined";
    if (!isDeno)
        return code;
    let result = code;
    for (const { pattern, replacement } of NPM_REWRITES) {
        result = result.replace(pattern, replacement);
    }
    return result;
}
async function transpileWithEsbuild(source, modulePath, resolveDir) {
    const { build } = await import("esbuild");
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
    if (result.errors?.length) {
        const firstError = result.errors[0]?.text || "unknown error";
        throw toError(createError({
            type: "render",
            message: `[Script] Build failed: ${firstError}`,
        }));
    }
    return result.outputFiles?.[0]?.text ?? "export {}";
}
async function importFromTempFile(fs, code) {
    const tempDir = await fs.makeTempDir({ prefix: "vf-script-" });
    const tempFile = join(tempDir, "module.mjs");
    await fs.writeTextFile(tempFile, code);
    try {
        return (await import(createFileUrl(tempFile)));
    }
    finally {
        await fs.remove(tempDir, { recursive: true });
    }
}
async function loadScriptModule(modulePath, projectDir, adapter) {
    const fs = createFileSystem();
    const normalizedPath = normalizeModulePath(modulePath, projectDir);
    logger.debug(`[Script] Checking if file exists locally: ${normalizedPath}`);
    if (await fs.exists(normalizedPath)) {
        logger.debug(`[Script] File exists locally, using direct import: ${normalizedPath}`);
        return (await import(createFileUrl(normalizedPath)));
    }
    logger.debug(`[Script] File not local, using adapter-based loading: ${modulePath}`);
    const source = await readFileWithFallback(adapter, modulePath, normalizedPath);
    logger.debug(`[Script] Read ${source.length} bytes from adapter`);
    const resolveDir = dirname(normalizedPath) || projectDir;
    const transpiled = await transpileWithEsbuild(source, modulePath, resolveDir);
    logger.debug(`[Script] Transpiled ${modulePath}`);
    return await importFromTempFile(fs, rewriteNpmImports(transpiled));
}
