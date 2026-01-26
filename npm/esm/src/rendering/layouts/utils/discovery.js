import { memoizeHash as simpleHash, rendererLogger as logger } from "../../../utils/index.js";
import { dirname, extname, join } from "../../../platform/compat/path-helper.js";
import { LAYOUT_EXTENSIONS } from "../types.js";
// Explicit cache for layout discovery - can be cleared for HMR
const layoutDiscoveryCache = new Map();
/**
 * Clear the layout discovery cache.
 * Call this when config or layout files change to ensure HMR works correctly.
 */
export function clearLayoutDiscoveryCache() {
    logger.debug("[discovery] Clearing layout discovery cache", {
        size: layoutDiscoveryCache.size,
    });
    layoutDiscoveryCache.clear();
}
export async function discoverNestedLayouts(pageFilePath, rootDir, projectDir, adapter) {
    const key = simpleHash(pageFilePath, rootDir);
    const cached = layoutDiscoveryCache.get(key);
    if (cached)
        return cached;
    const result = await discoverNestedLayoutsImpl(pageFilePath, rootDir, projectDir, adapter);
    layoutDiscoveryCache.set(key, result);
    return result;
}
async function discoverNestedLayoutsImpl(pageFilePath, rootDir, _projectDir, adapter) {
    const nestedLayouts = [];
    try {
        const candidates = collectLayoutCandidates(pageFilePath, rootDir);
        const existing = await resolveExistingFiles(candidates.reverse(), adapter);
        logger.debug("Found layout files:", existing);
        addLayoutsFromFiles(existing, nestedLayouts);
        await addMissedAncestorLayouts(pageFilePath, rootDir, existing, nestedLayouts, adapter);
    }
    catch (e) {
        logger.warn("Nested layout discovery failed", e);
    }
    return nestedLayouts;
}
function collectLayoutCandidates(pageFilePath, rootDir) {
    const candidates = [];
    let currentDir = dirname(pageFilePath);
    while (currentDir.startsWith(rootDir)) {
        for (const ext of LAYOUT_EXTENSIONS) {
            candidates.push(join(currentDir, `layout.${ext}`));
        }
        const parent = dirname(currentDir);
        if (parent === currentDir || currentDir === rootDir)
            break;
        currentDir = parent;
    }
    if (!candidates.includes(join(rootDir, "layout.mdx"))) {
        for (const ext of LAYOUT_EXTENSIONS) {
            candidates.push(join(rootDir, `layout.${ext}`));
        }
    }
    return candidates;
}
async function resolveExistingFiles(candidates, adapter) {
    const results = await Promise.allSettled(candidates.map((file) => adapter.fs.stat(file)));
    const existing = [];
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (!result)
            continue;
        if (result.status === "fulfilled" && result.value.isFile) {
            existing.push(candidates[i]);
            continue;
        }
        if (result.status === "rejected") {
            logger.debug("[layout] stat layout candidate failed", result.reason);
        }
    }
    return existing;
}
function addLayoutsFromFiles(files, nestedLayouts) {
    for (const file of files) {
        const ext = extname(file).toLowerCase();
        if (ext === ".mdx" || ext === ".md") {
            nestedLayouts.push({ kind: "mdx", path: file });
            continue;
        }
        if (ext === ".tsx" || ext === ".jsx" || ext === ".ts" || ext === ".js") {
            logger.debug("Adding TSX layout:", file);
            nestedLayouts.push({
                kind: "tsx",
                component: undefined,
                componentPath: file,
                path: file,
            });
        }
    }
}
async function addMissedAncestorLayouts(pageFilePath, rootDir, existing, nestedLayouts, adapter) {
    try {
        const included = new Set(existing);
        const candidates = [];
        let dir = dirname(pageFilePath);
        while (dir.startsWith(rootDir)) {
            for (const ext of LAYOUT_EXTENSIONS) {
                const candidate = join(dir, `layout.${ext}`);
                if (!included.has(candidate))
                    candidates.push(candidate);
            }
            const parent = dirname(dir);
            if (parent === dir)
                break;
            dir = parent;
        }
        const results = await Promise.allSettled(candidates.map((cand) => adapter.fs.stat(cand)));
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const cand = candidates[i];
            if (!result || !cand)
                continue;
            if (result.status === "fulfilled" && result.value.isFile) {
                addLayoutsFromFiles([cand], nestedLayouts);
                included.add(cand);
                continue;
            }
            if (result.status === "rejected") {
                logger.debug("[layout] stat nested tsx/jsx layout failed", result.reason);
            }
        }
    }
    catch (e) {
        logger.debug("[layout] nested layout fallback scan failed", e);
    }
}
