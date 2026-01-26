import { replaceSpecifiers } from "./lexer.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { stat } from "../../platform/compat/fs.js";
import { withSpan, withSpanSync } from "../../observability/tracing/otlp-setup.js";
const CROSS_PROJECT_VERSIONED_PATTERN = /^([a-z0-9-]+)@([\d^~x][\d.x^~-]*)\/@\/(.+)$/;
const CROSS_PROJECT_LATEST_PATTERN = /^([a-z0-9-]+)\/@\/(.+)$/;
export function isCrossProjectImport(specifier) {
    return CROSS_PROJECT_VERSIONED_PATTERN.test(specifier) ||
        CROSS_PROJECT_LATEST_PATTERN.test(specifier);
}
export function parseCrossProjectImport(specifier) {
    const versionedMatch = specifier.match(CROSS_PROJECT_VERSIONED_PATTERN);
    if (versionedMatch) {
        const [, projectSlug, version, path] = versionedMatch;
        return { projectSlug: projectSlug, version: version, path: path };
    }
    const latestMatch = specifier.match(CROSS_PROJECT_LATEST_PATTERN);
    if (!latestMatch)
        return null;
    const [, projectSlug, path] = latestMatch;
    return { projectSlug: projectSlug, version: "latest", path: path };
}
export function resolveCrossProjectImports(code, options) {
    return Promise.resolve(withSpanSync("transforms.esm.resolveCrossProjectImports", () => {
        const ssr = options.ssr ?? false;
        if (ssr)
            return code;
        return replaceSpecifiers(code, (specifier) => {
            const parsed = parseCrossProjectImport(specifier);
            if (!parsed)
                return null;
            const { projectSlug, version, path } = parsed;
            const modulePath = /\.(js|mjs|jsx|ts|tsx|mdx)$/.test(path) ? path : `${path}.tsx`;
            const projectRef = version === "latest" ? projectSlug : `${projectSlug}@${version}`;
            const moduleServerUrl = `/_vf_modules/_cross/${projectRef}/@/${modulePath}`;
            logger.debug("[CrossProjectImport] Rewriting", { from: specifier, to: moduleServerUrl });
            return moduleServerUrl;
        });
    }, { "transforms.ssr": options.ssr ?? false }));
}
export function blockExternalUrlImports(code, _filePath) {
    return Promise.resolve({ code, blockedUrls: [] });
}
export function resolveVeryfrontImports(code) {
    return Promise.resolve(replaceSpecifiers(code, (specifier) => {
        if (specifier.startsWith("@veryfront/")) {
            return specifier.replace("@veryfront/", "veryfront/");
        }
        if (specifier === "@veryfront")
            return "veryfront";
        return null;
    }));
}
export function resolveVeryfrontSubpathImports(code, ssr = false) {
    if (ssr)
        return Promise.resolve(code);
    return Promise.resolve(replaceSpecifiers(code, (specifier) => {
        if (!specifier.startsWith("#veryfront/"))
            return null;
        const path = specifier.substring("#veryfront/".length);
        const normalizedPath = path.replace(/\.(tsx?|jsx)$/, ".js");
        return `/_vf_modules/_veryfront/${normalizedPath}`;
    }));
}
function getRelativeFilePath(filePath, normalizedProjectDir) {
    if (filePath.startsWith(normalizedProjectDir)) {
        return filePath.substring(normalizedProjectDir.length + 1);
    }
    if (!filePath.startsWith("/"))
        return filePath;
    const pathParts = filePath.split("/");
    const projectParts = normalizedProjectDir.split("/");
    const lastProjectPart = projectParts[projectParts.length - 1];
    const projectIndex = lastProjectPart ? pathParts.indexOf(lastProjectPart) : -1;
    if (projectIndex >= 0) {
        return pathParts.slice(projectIndex + 1).join("/");
    }
    return filePath;
}
export function resolvePathAliases(code, filePath, projectDir, ssr = false) {
    return Promise.resolve(withSpanSync("transforms.esm.resolvePathAliases", () => {
        const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");
        const relativeFilePath = getRelativeFilePath(filePath, normalizedProjectDir);
        const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));
        const depth = fileDir.split("/").filter(Boolean).length;
        const relativeToRoot = depth === 0 ? "." : "../".repeat(depth).slice(0, -1);
        return replaceSpecifiers(code, (specifier) => {
            if (!specifier.startsWith("@/"))
                return null;
            const path = specifier.substring(2);
            const relativePath = depth === 0 ? `./${path}` : `${relativeToRoot}/${path}`;
            if (!/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(relativePath)) {
                return `${relativePath}.js`;
            }
            if (ssr) {
                return relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");
            }
            return relativePath;
        });
    }, { "transforms.ssr": ssr }));
}
export function resolveRelativeImports(code, filePath, projectDir, moduleServerUrl) {
    return Promise.resolve(withSpanSync("transforms.esm.resolveRelativeImports", () => {
        const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");
        const relativeFilePath = getRelativeFilePath(filePath, normalizedProjectDir);
        const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));
        return replaceSpecifiers(code, (specifier) => {
            if (!specifier.startsWith("./") && !specifier.startsWith("../"))
                return null;
            const rewrittenSpecifier = /\.(tsx?|jsx)$/.test(specifier)
                ? specifier.replace(/\.(tsx?|jsx)$/, ".js")
                : specifier;
            if (!moduleServerUrl)
                return rewrittenSpecifier;
            const resolvedPath = resolveRelativePath(fileDir, rewrittenSpecifier);
            return `${moduleServerUrl}/${resolvedPath}`;
        });
    }, { "transforms.has_module_server": !!moduleServerUrl }));
}
function resolveRelativePath(currentDir, importPath) {
    return resolvePath(currentDir.split("/").filter(Boolean), importPath).join("/");
}
function resolvePath(baseParts, relativePath) {
    const resolvedParts = [...baseParts];
    for (const part of relativePath.split("/").filter(Boolean)) {
        if (part === "..")
            resolvedParts.pop();
        else if (part !== ".")
            resolvedParts.push(part);
    }
    return resolvedParts;
}
export function resolveRelativeImportsToAbsolute(code, filePath, _projectDir) {
    return withSpan("transforms.esm.resolveRelativeImportsToAbsolute", async () => {
        const normalizedFilePath = filePath.replace(/\\/g, "/");
        const fileDir = normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf("/"));
        const specifiersToResolve = [];
        await replaceSpecifiers(code, (specifier) => {
            if (specifier.startsWith("./") || specifier.startsWith("../")) {
                specifiersToResolve.push(specifier);
            }
            return null;
        });
        const resolvedImports = new Map();
        for (const specifier of specifiersToResolve) {
            const absolutePath = resolveAbsolutePath(fileDir, specifier);
            const resolvedPath = await findFileWithExtension(absolutePath);
            resolvedImports.set(specifier, `file://${resolvedPath}`);
        }
        return replaceSpecifiers(code, (specifier) => resolvedImports.get(specifier) ?? null);
    }, { "transforms.specifiers_count": 0 });
}
async function findFileWithExtension(basePath) {
    if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(basePath))
        return basePath;
    const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
    for (const ext of extensions) {
        const fullPath = basePath + ext;
        try {
            const fileStat = await stat(fullPath);
            if (fileStat.isFile)
                return fullPath;
        }
        catch {
            // ignore
        }
    }
    return basePath + ".ts";
}
export function resolveRelativeImportsForNodeSSR(code) {
    return Promise.resolve(replaceSpecifiers(code, (specifier) => {
        if (!specifier.startsWith("./") && !specifier.startsWith("../"))
            return null;
        return specifier.replace(/\.(tsx|ts|jsx)$/, ".js");
    }));
}
export function resolveRelativeImportsForSSR(code) {
    return Promise.resolve(replaceSpecifiers(code, (specifier) => {
        if (!specifier.startsWith("./") && !specifier.startsWith("../"))
            return null;
        if (/\.(js|mjs|cjs)$/.test(specifier))
            return null;
        const withoutExt = specifier.replace(/\.(tsx?|jsx|mdx)$/, "");
        return `${withoutExt}.js`;
    }));
}
function resolveAbsolutePath(baseDir, relativePath) {
    return `/${resolvePath(baseDir.split("/").filter(Boolean), relativePath).join("/")}`;
}
