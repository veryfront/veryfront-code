import { join } from "../../../../../deps/deno.land/std@0.220.0/path/mod.js";
import { rendererLogger as logger } from "../../../../utils/index.js";
import { DIRECTORY_PREFIXES, FRAMEWORK_ROOT, LOG_PREFIX_MDX_LOADER, MODULE_EXTENSIONS, } from "../constants.js";
import { getLocalFs } from "../cache/index.js";
function decodeContent(content) {
    return typeof content === "string" ? content : new TextDecoder().decode(content);
}
async function tryReadFile(path, readFile) {
    try {
        const content = await readFile(path);
        return { sourceCode: decodeContent(content), actualFilePath: path };
    }
    catch {
        return null;
    }
}
function stripTrailingSlashes(path) {
    return path.replace(/\/+$/, "");
}
export async function resolveModuleFile(normalizedPath, adapter, projectDir) {
    const filePathWithoutJs = normalizedPath.replace(/^_vf_modules\//, "").replace(/\.js$/, "");
    const hasKnownExt = MODULE_EXTENSIONS.some((ext) => filePathWithoutJs.endsWith(ext));
    const filePathWithoutExt = hasKnownExt
        ? filePathWithoutJs.replace(/\.(tsx|ts|jsx|js|mdx)$/, "")
        : filePathWithoutJs;
    if (adapter.fs.resolveFile) {
        for (const prefix of DIRECTORY_PREFIXES) {
            const basePath = prefix + filePathWithoutExt;
            const resolvedPath = await adapter.fs.resolveFile(basePath);
            if (!resolvedPath)
                continue;
            try {
                const content = await adapter.fs.readFile(resolvedPath);
                logger.debug(`${LOG_PREFIX_MDX_LOADER} Found file via index`, {
                    normalizedPath,
                    basePath,
                    resolvedPath,
                });
                return { sourceCode: decodeContent(content), actualFilePath: resolvedPath };
            }
            catch (error) {
                logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to read resolved file`, {
                    resolvedPath,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Extension resolution failed via index`, {
            normalizedPath,
            filePathWithoutExt,
        });
    }
    else if (projectDir) {
        const localFs = getLocalFs();
        const normalizedProjectDir = stripTrailingSlashes(projectDir);
        for (const prefix of DIRECTORY_PREFIXES) {
            if (hasKnownExt) {
                const absolutePath = join(normalizedProjectDir, prefix + filePathWithoutJs);
                const result = await tryReadFile(absolutePath, (p) => localFs.readTextFile(p));
                if (result)
                    return result;
            }
            for (const ext of MODULE_EXTENSIONS) {
                const absolutePath = join(normalizedProjectDir, prefix + filePathWithoutExt + ext);
                const result = await tryReadFile(absolutePath, (p) => localFs.readTextFile(p));
                if (result)
                    return result;
            }
            for (const ext of MODULE_EXTENSIONS) {
                const absolutePath = join(normalizedProjectDir, prefix, filePathWithoutExt, `index${ext}`);
                const result = await tryReadFile(absolutePath, (p) => localFs.readTextFile(p));
                if (result)
                    return result;
            }
        }
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Extension resolution failed (no resolveFile)`, {
            normalizedPath,
            filePathWithoutExt,
            projectDir: normalizedProjectDir,
        });
    }
    const frameworkLookups = [
        ["lib/", join(FRAMEWORK_ROOT, "src")],
        ["src/exports/", FRAMEWORK_ROOT],
        ["exports/", join(FRAMEWORK_ROOT, "src")],
        ["react/", join(FRAMEWORK_ROOT, "src")],
    ];
    const localFs = getLocalFs();
    for (const [prefix, frameworkDir] of frameworkLookups) {
        if (!filePathWithoutJs.startsWith(prefix))
            continue;
        for (const ext of MODULE_EXTENSIONS) {
            const frameworkPath = join(frameworkDir, filePathWithoutJs + ext);
            try {
                const stat = await localFs.stat(frameworkPath);
                if (!stat?.isFile)
                    continue;
                const content = await localFs.readTextFile(frameworkPath);
                logger.debug(`${LOG_PREFIX_MDX_LOADER} Found framework file`, {
                    prefix,
                    basePath: filePathWithoutJs,
                    resolvedPath: frameworkPath,
                });
                return { sourceCode: content, actualFilePath: frameworkPath };
            }
            catch {
                // Continue trying other extensions
            }
        }
    }
    return null;
}
export async function resolveFileWithExtension(relativePath, readFile) {
    const extensions = ["", ".tsx", ".ts", ".jsx", ".js", ".mdx"];
    for (const tryExt of extensions) {
        const tryPath = relativePath + tryExt;
        const content = await readFile(tryPath);
        if (content === null)
            continue;
        const extension = tryExt || tryPath.split(".").pop() || "";
        return { content, resolvedPath: tryPath, extension };
    }
    for (const tryExt of [".tsx", ".ts", ".jsx", ".js", ".mdx"]) {
        const tryPath = `${relativePath}/index${tryExt}`;
        const content = await readFile(tryPath);
        if (content === null)
            continue;
        return { content, resolvedPath: tryPath, extension: tryExt };
    }
    return null;
}
