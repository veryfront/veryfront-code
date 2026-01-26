/**
 * App Router Entity Resolution
 *
 * Handles resolution of App Router page entities, including:
 * - Exact route matching
 * - Dynamic segment matching ([id], [...slug], etc.)
 * - Page file loading with frontmatter extraction
 */
import { isDynamicSegment } from "../utils/route-path-utils.js";
import { join } from "../platform/compat/path-helper.js";
import { extract } from "../platform/compat/std/front-matter-yaml.js";
export async function getAppRouteEntity(projectDir, slug, adapter, appDirName = "app") {
    const exactMatch = await tryExactMatch(projectDir, slug, adapter, appDirName);
    if (exactMatch)
        return exactMatch;
    return tryDynamicMatch(projectDir, slug, adapter, appDirName);
}
async function tryExactMatch(projectDir, slug, adapter, appDirName) {
    const base = slug ? join(projectDir, appDirName, slug) : join(projectDir, appDirName);
    if (adapter.fs.resolveFile) {
        for (const basePath of [`${base}/page`, base]) {
            const resolvedPath = await adapter.fs.resolveFile(basePath);
            if (!resolvedPath)
                continue;
            const entity = await tryLoadPageFile(resolvedPath, slug, adapter);
            if (entity)
                return entity;
        }
        return null;
    }
    const candidates = [
        `${base}/page.mdx`,
        `${base}/page.md`,
        `${base}/page.tsx`,
        `${base}/page.jsx`,
        `${base}/page.ts`,
        `${base}/page.js`,
        `${base}.mdx`,
        `${base}.md`,
        `${base}.tsx`,
        `${base}.jsx`,
        `${base}.ts`,
        `${base}.js`,
    ];
    for (const file of candidates) {
        const entity = await tryLoadPageFile(file, slug, adapter);
        if (entity)
            return entity;
    }
    return null;
}
async function tryDynamicMatch(projectDir, slug, adapter, appDirName) {
    const segments = slug ? slug.split("/").filter(Boolean) : [];
    let currentDir = join(projectDir, appDirName);
    for (const segment of segments) {
        const exactPath = join(currentDir, segment);
        try {
            const stat = await adapter.fs.stat(exactPath);
            if (stat.isDirectory) {
                currentDir = exactPath;
                continue;
            }
        }
        catch {
            // Exact match failed, try dynamic segments
        }
        let dynamicDirName = null;
        let isCatchAll = false;
        try {
            const entries = await adapter.fs.readDir(currentDir);
            for await (const entry of entries) {
                if (!entry.isDirectory || !isDynamicSegment(entry.name))
                    continue;
                dynamicDirName = entry.name;
                isCatchAll = entry.name.startsWith("[...");
                break;
            }
        }
        catch {
            // adapter.fs.readDir failed - no fallback to Deno for npm compatibility
        }
        if (!dynamicDirName)
            return null;
        currentDir = join(currentDir, dynamicDirName);
        if (isCatchAll)
            break;
    }
    for (const ext of [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"]) {
        const pageFile = join(currentDir, `page${ext}`);
        const entity = await tryLoadPageFile(pageFile, slug, adapter);
        if (entity)
            return entity;
    }
    return null;
}
async function tryLoadPageFile(file, slug, adapter) {
    try {
        const info = await adapter.fs.stat(file);
        if (!info.isFile)
            return null;
    }
    catch {
        return null;
    }
    let raw;
    try {
        raw = await adapter.fs.readFile(file);
    }
    catch {
        return null;
    }
    let content = raw;
    let fm = {};
    if (raw.trim().startsWith("---")) {
        try {
            const ex = extract(raw);
            content = ex.body;
            fm = ex.attrs ?? {};
        }
        catch {
            // Malformed frontmatter - use raw content as-is
            // This allows pages with invalid YAML to still render
            content = raw;
        }
    }
    const frontmatter = { ...fm };
    if (typeof frontmatter.layout === "boolean") {
        frontmatter.layout = frontmatter.layout ? "default" : "false";
    }
    return {
        entity: {
            id: file,
            path: file,
            slug,
            type: "page",
            isPage: true,
            isLayout: false,
            isComponent: false,
            content,
            frontmatter: frontmatter,
        },
    };
}
