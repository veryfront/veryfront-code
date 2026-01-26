import { createFileSystem } from "../../../../../platform/compat/fs.js";
import * as pathHelper from "../../../../../platform/compat/path-helper.js";
const fs = createFileSystem();
const FILE_PATTERNS = [
    "app/{path}/page.mdx",
    "app/{path}/page.md",
    "app/{path}/page.tsx",
    "app/{path}/page.ts",
    "app/{path}/page.jsx",
    "app/{path}/page.js",
    "app/{path}.mdx",
    "app/{path}.md",
    "app/{path}.tsx",
    "app/{path}.ts",
    "app/{path}.jsx",
    "app/{path}.js",
];
const ROOT_PATTERNS = [
    "app/page.mdx",
    "app/page.md",
    "app/page.tsx",
    "app/page.ts",
    "app/page.jsx",
    "app/page.js",
];
export async function resolveComponentPath(pathname, projectDir, fsAdapter) {
    const cleanPath = cleanPathname(pathname);
    if (cleanPath === "index") {
        const rootMatch = await findFirstExistingPath(projectDir, ROOT_PATTERNS, fsAdapter);
        if (rootMatch)
            return rootMatch;
    }
    return findFirstExistingPath(projectDir, FILE_PATTERNS.map((pattern) => pattern.replace("{path}", cleanPath)), fsAdapter);
}
function cleanPathname(pathname) {
    const cleaned = pathname.replace(/^\//, "").replace(/^_veryfront\/rsc\/render\//, "");
    return cleaned || "index";
}
async function findFirstExistingPath(projectDir, patterns, fsAdapter) {
    for (const pattern of patterns) {
        const fullPath = pathHelper.join(projectDir, pattern);
        if (await fileExists(fullPath, fsAdapter))
            return fullPath;
    }
    return null;
}
async function fileExists(path, fsAdapter) {
    try {
        const stat = fsAdapter ? await fsAdapter.stat(path) : await fs.stat(path);
        return stat.isFile;
    }
    catch {
        return false;
    }
}
export function extractParams(_pathname) {
    return {};
}
