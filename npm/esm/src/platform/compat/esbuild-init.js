/**
 * Early esbuild binary initialization for deno compile.
 *
 * This module MUST be imported at the very start of the CLI entry point,
 * BEFORE any other imports that might load esbuild. This ensures the
 * ESBUILD_BINARY_PATH environment variable is set before esbuild reads it.
 */
import * as dntShim from "../../../_dnt.shims.js";
import process from "node:process";
const ESBUILD_VERSION = "0.20.2";
function getTempDir() {
    return dntShim.Deno.env.get("TMPDIR") ?? dntShim.Deno.env.get("TEMP") ?? dntShim.Deno.env.get("TMP") ?? "/tmp";
}
function getEsbuildCacheDir() {
    return `${getTempDir()}/veryfront-esbuild`;
}
function isDenoCompiled() {
    try {
        const denoExecPath = dntShim.Deno.execPath().toLowerCase();
        const hasDenoInPath = denoExecPath.includes("/deno") || denoExecPath.includes("\\deno");
        return !hasDenoInPath || denoExecPath.includes("veryfront");
    }
    catch {
        return false;
    }
}
function getEsbuildBinaryName() {
    const archMap = {
        x86_64: "x64",
        aarch64: "arm64",
    };
    const esbuildArch = archMap[dntShim.Deno.build.arch] || dntShim.Deno.build.arch;
    return `@esbuild/${dntShim.Deno.build.os}-${esbuildArch}`;
}
function getVFSBasePath() {
    const filePath = new URL(globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url).pathname;
    const denoCompileMatch = filePath.match(/^(.*\/deno-compile-[^/]+)\//);
    if (denoCompileMatch?.[1]) {
        return denoCompileMatch[1];
    }
    const parts = filePath.split("/");
    const srcIndex = parts.lastIndexOf("src");
    if (srcIndex > 0) {
        return parts.slice(0, srcIndex).join("/");
    }
    return `${getTempDir()}/deno-compile-veryfront`;
}
async function findEsbuildInVFS() {
    const binaryName = getEsbuildBinaryName();
    const vfsBase = getVFSBasePath();
    const possiblePaths = [
        `${vfsBase}/node_modules/${binaryName}/bin/esbuild`,
        `${vfsBase}/node_modules/.deno/${binaryName}@${ESBUILD_VERSION}/node_modules/${binaryName}/bin/esbuild`,
        `${vfsBase}/node_modules/.deno/esbuild@${ESBUILD_VERSION}/node_modules/${binaryName}/bin/esbuild`,
        `${vfsBase}/node_modules/esbuild/bin/esbuild`,
    ];
    for (const vfsPath of possiblePaths) {
        try {
            const stat = await dntShim.Deno.stat(vfsPath);
            if (stat.isFile)
                return vfsPath;
        }
        catch {
            continue;
        }
    }
    return null;
}
async function extractEsbuildBinary() {
    const cacheDir = getEsbuildCacheDir();
    const targetPath = `${cacheDir}/esbuild-${ESBUILD_VERSION}`;
    // Check if already extracted
    try {
        const stat = await dntShim.Deno.stat(targetPath);
        if (stat.isFile && stat.mode && (stat.mode & 0o111)) {
            return targetPath;
        }
    }
    catch {
        // Doesn't exist, need to extract
    }
    const vfsPath = await findEsbuildInVFS();
    if (!vfsPath) {
        return null;
    }
    await dntShim.Deno.mkdir(cacheDir, { recursive: true });
    const binary = await dntShim.Deno.readFile(vfsPath);
    await dntShim.Deno.writeFile(targetPath, binary, { mode: 0o755 });
    console.log(`[esbuild] Extracted binary from VFS to ${targetPath}`);
    return targetPath;
}
// Run initialization immediately when this module is imported
if (!dntShim.Deno.env.get("ESBUILD_BINARY_PATH") && isDenoCompiled()) {
    try {
        const binaryPath = await extractEsbuildBinary();
        if (binaryPath) {
            // Set in BOTH Deno.env and process.env
            dntShim.Deno.env.set("ESBUILD_BINARY_PATH", binaryPath);
            process.env.ESBUILD_BINARY_PATH = binaryPath;
            console.log(`[esbuild] Set ESBUILD_BINARY_PATH=${binaryPath}`);
        }
    }
    catch (error) {
        console.warn(`[esbuild] Binary extraction failed:`, error);
    }
}
