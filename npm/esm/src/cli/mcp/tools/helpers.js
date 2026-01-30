/**
 * Shared helpers for MCP advanced tools.
 */
import { createFileSystem } from "../../../platform/compat/fs.js";
import { join } from "../../../platform/compat/path/index.js";
import { cwd } from "../../../platform/compat/process.js";
// ============================================================================
// Utilities
// ============================================================================
let cachedFs = null;
export function getFs() {
    cachedFs ??= createFileSystem();
    return cachedFs;
}
export function getProjectDir(projectPath) {
    return projectPath ?? cwd();
}
export async function ensureDir(path) {
    try {
        await getFs().mkdir(path, { recursive: true });
    }
    catch {
        // Directory already exists
    }
}
export async function directoryExists(path) {
    try {
        const stat = await getFs().stat(path);
        return stat.isDirectory;
    }
    catch {
        return false;
    }
}
export async function fileExists(path) {
    return await getFs().exists(path);
}
export function toComponentName(slug) {
    const base = slug.split("/").pop() || slug;
    return base
        .replace(/\W+/g, " ")
        .split(" ")
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join("");
}
export function toSlug(name) {
    return name
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9_\-[\]/]/g, "")
        .replace(/\/+/g, "/")
        .toLowerCase();
}
export function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
// ============================================================================
// Route Scanning
// ============================================================================
const ROUTE_FILE_MAP = {
    "page.tsx": "page",
    "page.jsx": "page",
    "page.mdx": "page",
    "layout.tsx": "layout",
    "layout.jsx": "layout",
    "route.ts": "api",
    "route.js": "api",
    "error.tsx": "error",
    "error.jsx": "error",
    "loading.tsx": "loading",
    "loading.jsx": "loading",
    "not-found.tsx": "not-found",
    "not-found.jsx": "not-found",
};
const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
function toRouteSegment(dirName) {
    if (dirName.startsWith("[...") && dirName.endsWith("]"))
        return `*${dirName.slice(4, -1)}`;
    if (dirName.startsWith("[") && dirName.endsWith("]"))
        return `:${dirName.slice(1, -1)}`;
    return dirName;
}
async function detectHttpMethods(filePath, fs) {
    const content = await fs.readTextFile(filePath);
    const methods = [];
    for (const method of HTTP_METHODS) {
        const regex = new RegExp(`export\\s+(const|function|async\\s+function)\\s+${method}`, "i");
        if (regex.test(content))
            methods.push(method);
    }
    return methods.length ? methods : ["GET"];
}
export async function scanDirectory(dir, baseRoute, routes, fs) {
    try {
        for await (const entry of fs.readDir(dir)) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory) {
                if (entry.name.startsWith("_"))
                    continue;
                const segment = toRouteSegment(entry.name);
                const newRoute = baseRoute === "/" ? `/${segment}` : `${baseRoute}/${segment}`;
                await scanDirectory(fullPath, newRoute, routes, fs);
                continue;
            }
            if (!entry.isFile)
                continue;
            const routeType = ROUTE_FILE_MAP[entry.name.toLowerCase()];
            if (!routeType)
                continue;
            const routePath = baseRoute || "/";
            const routeInfo = { path: routePath, type: routeType, file: fullPath };
            if (routeType === "api")
                routeInfo.methods = await detectHttpMethods(fullPath, fs);
            routes.push(routeInfo);
        }
    }
    catch {
        // Directory doesn't exist or permission error
    }
}
export const ROUTE_FILTER_MAP = {
    pages: ["page"],
    api: ["api"],
    layouts: ["layout"],
};
