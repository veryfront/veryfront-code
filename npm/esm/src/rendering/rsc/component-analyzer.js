import { join, relative } from "../../platform/compat/path/index.js";
import { serverLogger } from "../../utils/index.js";
import { toBase64Url } from "../../utils/path-utils.js";
import { runtime } from "../../platform/adapters/detect.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { extractExportNames } from "./export-extractor.js";
export async function analyzeComponent(filePath, fs) {
    const content = await fs.readFile(filePath);
    const hasUseClient = detectDirective(content, "use client");
    const hasUseServer = detectDirective(content, "use server");
    // Determine component type: directive takes precedence over file naming convention
    const type = hasUseClient || filePath.includes(".client.") ? "client" : "server";
    return {
        type,
        filePath,
        exports: extractExportNames(content),
        id: generateComponentId(filePath),
        hasUseClient,
        hasUseServer,
    };
}
function detectDirective(content, directive) {
    // Match directives like 'use client' or "use client" at the start of a line
    const directivePattern = new RegExp(`^\\s*['"]${directive}['"];?\\s*$`, "m");
    return directivePattern.test(content);
}
function generateComponentId(filePath) {
    const normalized = filePath.replace(/\.(tsx?|jsx?)$/, "").replace(/\.(client|server)$/, "");
    const parts = normalized.split("/");
    const fileName = parts.at(-1);
    if (fileName === "index") {
        return toPascalCase(parts.at(-2) ?? "Unknown");
    }
    return toPascalCase(fileName ?? "Unknown");
}
function toPascalCase(str) {
    return str
        .split(/[-_\s]+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("");
}
export async function buildClientManifest(projectDir, appDir = "app", fs) {
    const manifest = new Map();
    const appPath = join(projectDir, appDir);
    const fsAdapter = fs ?? (await getFsAdapter(manifest));
    if (!fsAdapter)
        return manifest;
    try {
        await walkDirectory(appPath, async (filePath) => {
            if (!/\.(tsx?|jsx?)$/.test(filePath))
                return;
            const analysis = await analyzeComponent(filePath, fsAdapter);
            if (analysis.type !== "client")
                return;
            const relativePath = relative(projectDir, filePath);
            manifest.set(analysis.id, {
                id: analysis.id,
                path: `/_veryfront/fs/${toBase64Url(filePath)}`,
                exports: analysis.exports,
            });
            serverLogger.debug(`Found client component: ${analysis.id} at ${relativePath}`);
        }, fsAdapter);
    }
    catch (error) {
        serverLogger.warn(`Failed to build client manifest:`, error);
    }
    return manifest;
}
async function getFsAdapter(_manifest) {
    try {
        const adapter = await runtime.get();
        return adapter.fs;
    }
    catch (error) {
        serverLogger.warn(`Failed to get file system adapter:`, error);
        return undefined;
    }
}
async function walkDirectory(dir, callback, fs) {
    try {
        if (!fs) {
            throw toError(createError({
                type: "config",
                message: "FileSystemAdapter is required for walkDirectory",
            }));
        }
        const entries = fs.readDir(dir);
        for await (const entry of entries) {
            const path = join(dir, entry.name);
            if (entry.isDirectory) {
                if (shouldSkipDirectory(dir, entry.name))
                    continue;
                await walkDirectory(path, callback, fs);
                continue;
            }
            if (entry.isFile) {
                await callback(path);
            }
        }
    }
    catch (error) {
        if (isNotFoundError(error))
            return;
        throw error;
    }
}
function shouldSkipDirectory(parentDir, name) {
    // Skip node_modules and hidden dirs, but allow .veryfront (excluding system subdirs)
    if (name === "node_modules")
        return true;
    if (name.startsWith(".") && name !== ".veryfront")
        return true;
    if (!parentDir.includes(".veryfront"))
        return false;
    return ["cache", "compiled", "tmp", "temp", "output", "optimized-images", "css"].includes(name);
}
function isNotFoundError(error) {
    if (error?.code === "ENOENT")
        return true;
    const message = String(error?.message ?? "").toLowerCase();
    return message.includes("not found") || message.includes("no such file");
}
