import * as esbuild from "esbuild";
import { join } from "../../../deps/deno.land/std@0.220.0/path/mod.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { isCrossProjectImport, parseCrossProjectImport } from "./path-resolver.js";
import { parseImports } from "./lexer.js";
import { getLoaderFromPath } from "./transform-utils.js";
const FRAMEWORK_ROOT = new URL("../../../..", globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).url).pathname;
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
const HAS_EXTENSION_RE = /\.(tsx?|jsx?|mjs|cjs|mdx)$/;
export async function parseLocalImports(code, filePath, projectDir, adapter) {
    if (filePath.endsWith(".css") || filePath.endsWith(".json")) {
        return { imports: [], crossProjectImports: [], missing: [] };
    }
    const result = await esbuild.transform(code, {
        loader: getLoaderFromPath(filePath),
        format: "esm",
        target: "esnext",
        jsx: "automatic",
        jsxImportSource: "react",
        minify: false,
        sourcemap: false,
        treeShaking: false,
        keepNames: true,
    });
    const imports = await parseImports(result.code);
    const localImports = [];
    const crossProjectImports = [];
    const missingImports = [];
    for (const imp of imports) {
        const specifier = imp.n;
        if (!specifier)
            continue;
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
            const resolved = await resolveLocalImportPath(filePath, specifier, adapter);
            if (resolved) {
                localImports.push({ specifier, absolutePath: resolved });
                continue;
            }
            missingImports.push({
                specifier,
                fromFile: filePath,
                reason: `File not found: tried extensions ${EXTENSIONS.join(", ")}`,
            });
            continue;
        }
        if (specifier.startsWith("@/")) {
            const aliasPath = specifier.substring(2);
            const resolved = await resolveAliasImportPath(aliasPath, projectDir, adapter);
            if (resolved) {
                localImports.push({ specifier, absolutePath: resolved });
                continue;
            }
            missingImports.push({
                specifier,
                fromFile: filePath,
                reason: `Alias path not found: @/${aliasPath}`,
            });
            continue;
        }
        if (isCrossProjectImport(specifier)) {
            const parsed = parseCrossProjectImport(specifier);
            if (parsed) {
                crossProjectImports.push({
                    specifier,
                    projectSlug: parsed.projectSlug,
                    version: parsed.version,
                    path: parsed.path,
                });
            }
        }
    }
    return { imports: localImports, crossProjectImports, missing: missingImports };
}
async function checkFileExists(path, adapter) {
    try {
        if (adapter?.fs.stat) {
            const stat = await adapter.fs.stat(path);
            return stat.isFile;
        }
        const fs = createFileSystem();
        const stat = await fs.stat(path);
        return stat.isFile;
    }
    catch {
        return false;
    }
}
async function resolveLocalImportPath(fromFile, importSpecifier, adapter) {
    const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
    const basePath = resolveRelative(fromDir, importSpecifier);
    if (adapter?.fs.resolveFile) {
        try {
            const normalizedPath = basePath.replace(/^\/+/, "");
            const resolved = await adapter.fs.resolveFile(normalizedPath);
            if (resolved)
                return resolved;
        }
        catch {
            // Fall through to traditional resolution
        }
    }
    if (HAS_EXTENSION_RE.test(importSpecifier)) {
        return (await checkFileExists(basePath, adapter)) ? basePath : null;
    }
    for (const ext of EXTENSIONS) {
        const candidate = basePath + ext;
        if (await checkFileExists(candidate, adapter))
            return candidate;
    }
    const indexCandidates = EXTENSIONS.map((ext) => basePath + "/index" + ext);
    const results = await Promise.all(indexCandidates.map(async (path) => ({
        path,
        exists: await checkFileExists(path, adapter),
    })));
    return results.find((r) => r.exists)?.path ?? null;
}
async function resolveAliasImportPath(basePath, projectDir, adapter) {
    const normalizedPath = basePath.replace(/^\/+/, "");
    if (normalizedPath.startsWith("lib/")) {
        const fs = createFileSystem();
        const candidates = EXTENSIONS.map((ext) => join(FRAMEWORK_ROOT, "src", normalizedPath + ext));
        const results = await Promise.all(candidates.map(async (path) => {
            try {
                const stat = await fs.stat(path);
                return stat.isFile ? path : null;
            }
            catch {
                return null;
            }
        }));
        const found = results.find((r) => r !== null);
        if (found)
            return found;
    }
    if (adapter?.fs.resolveFile) {
        try {
            const resolved = await adapter.fs.resolveFile(normalizedPath);
            if (resolved)
                return resolved;
        }
        catch {
            // Fall through to manual resolution
        }
    }
    const fs = createFileSystem();
    const projectNormalizedDir = projectDir.replace(/\/+$/, "");
    if (HAS_EXTENSION_RE.test(normalizedPath)) {
        const absolutePath = join(projectNormalizedDir, normalizedPath);
        try {
            const stat = await fs.stat(absolutePath);
            return stat.isFile ? absolutePath : null;
        }
        catch {
            return null;
        }
    }
    const candidates = [
        ...EXTENSIONS.map((ext) => join(projectNormalizedDir, normalizedPath + ext)),
        ...EXTENSIONS.map((ext) => join(projectNormalizedDir, normalizedPath, "index" + ext)),
        ...(normalizedPath.startsWith("lib/")
            ? EXTENSIONS.map((ext) => join(FRAMEWORK_ROOT, "src", normalizedPath + ext))
            : []),
    ];
    const results = await Promise.all(candidates.map(async (path) => {
        try {
            const stat = await fs.stat(path);
            return stat.isFile ? path : null;
        }
        catch {
            return null;
        }
    }));
    return results.find((r) => r !== null) ?? null;
}
function resolveRelative(fromDir, importPath) {
    const parts = fromDir.split("/").filter(Boolean);
    const importParts = importPath.split("/").filter(Boolean);
    for (const part of importParts) {
        if (part === "..") {
            parts.pop();
            continue;
        }
        if (part !== ".")
            parts.push(part);
    }
    return "/" + parts.join("/");
}
