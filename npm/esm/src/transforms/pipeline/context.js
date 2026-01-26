import * as dntShim from "../../../_dnt.shims.js";
import { computeShortContentHash } from "../esm/transform-utils.js";
import { REACT_VERSION } from "../esm/package-registry.js";
async function detectProjectReactVersion(projectDir) {
    try {
        const content = await dntShim.Deno.readTextFile(`${projectDir}/package.json`);
        const pkg = JSON.parse(content);
        const reactVersion = { ...pkg.dependencies, ...pkg.devDependencies }?.react;
        if (reactVersion)
            return reactVersion.replace(/^[\^~]/, "");
    }
    catch {
        // Project doesn't have package.json or no React dependency
    }
    return REACT_VERSION;
}
function buildContext(source, filePath, projectDir, contentHash, options, reactVersion) {
    const target = options.ssr ? "ssr" : "browser";
    return {
        code: source,
        originalSource: source,
        filePath,
        projectDir,
        projectId: options.projectId,
        target,
        dev: options.dev ?? true,
        contentHash,
        moduleServerUrl: options.moduleServerUrl,
        vendorBundleHash: options.vendorBundleHash,
        apiBaseUrl: options.apiBaseUrl,
        jsxImportSource: options.jsxImportSource ?? "react",
        timing: new Map(),
        debug: false,
        metadata: new Map(),
        studioEmbed: options.studioEmbed,
        reactVersion,
    };
}
export async function createTransformContext(source, filePath, projectDir, options) {
    const [contentHash, reactVersion] = await Promise.all([
        computeShortContentHash(source),
        options.reactVersion
            ? Promise.resolve(options.reactVersion)
            : detectProjectReactVersion(projectDir),
    ]);
    return buildContext(source, filePath, projectDir, contentHash, options, reactVersion);
}
export function createTransformContextSync(source, filePath, projectDir, contentHash, options) {
    return buildContext(source, filePath, projectDir, contentHash, options, options.reactVersion ?? REACT_VERSION);
}
export function recordStageTiming(ctx, stage, startTime) {
    ctx.timing.set(stage, performance.now() - startTime);
}
export function getTotalTiming(ctx) {
    return [...ctx.timing.values()].reduce((sum, ms) => sum + ms, 0);
}
export function formatTimingLog(ctx) {
    const stageNames = [
        "parse",
        "compile",
        "aliases",
        "react",
        "context",
        "relative",
        "bare",
        "finalize",
    ];
    const result = {
        file: ctx.filePath.slice(-40),
        target: ctx.target,
    };
    for (const [stage, ms] of ctx.timing) {
        const name = stageNames[stage] ?? `stage${stage}`;
        result[`${name}Ms`] = ms.toFixed(1);
    }
    result.totalMs = getTotalTiming(ctx).toFixed(1);
    return result;
}
export function isSSR(ctx) {
    return ctx.target === "ssr";
}
export function isBrowser(ctx) {
    return ctx.target === "browser";
}
export function isMDX(ctx) {
    return ctx.filePath.endsWith(".mdx") || ctx.filePath.endsWith(".md");
}
export function isTypeScript(ctx) {
    return ctx.filePath.endsWith(".ts") || ctx.filePath.endsWith(".tsx");
}
export function getExtension(ctx) {
    const dot = ctx.filePath.lastIndexOf(".");
    return dot >= 0 ? ctx.filePath.slice(dot) : "";
}
