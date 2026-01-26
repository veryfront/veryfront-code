/****
 * Consolidated file discovery utility
 *
 * Provides unified file walking, filtering, and pattern matching
 * for route discovery, build asset scanning, and module discovery.
 */
import { join } from "../platform/compat/path/index.js";
import { isBun, isDeno, isNode } from "../platform/compat/runtime.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
async function getDefaultAdapter() {
    if (isDeno) {
        const { denoAdapter } = await import("../platform/adapters/runtime/deno/index.js");
        return denoAdapter;
    }
    if (isBun) {
        const { bunAdapter } = await import("../platform/adapters/runtime/bun/index.js");
        return bunAdapter;
    }
    if (isNode) {
        const { nodeAdapter } = await import("../platform/adapters/runtime/node/index.js");
        return nodeAdapter;
    }
    const { nodeAdapter } = await import("../platform/adapters/runtime/node/index.js");
    return nodeAdapter;
}
function matchesExtensions(fileName, extensions) {
    if (!extensions?.length)
        return true;
    return extensions.some((ext) => fileName.endsWith(ext));
}
function matchesPatterns(fileName, patterns) {
    if (!patterns?.length)
        return true;
    return patterns.some((pattern) => fileName.includes(pattern));
}
function shouldIgnore(name, ignorePatterns) {
    if (!ignorePatterns?.length)
        return false;
    return ignorePatterns.some((pattern) => name.includes(pattern));
}
function matchesFile(entryName, extensions, patterns) {
    return matchesExtensions(entryName, extensions) && matchesPatterns(entryName, patterns);
}
export async function* discoverFiles(options) {
    const { baseDir, extensions, patterns, recursive = true, maxDepth = Infinity, ignorePatterns, includeDirs = false, followSymlinks = false, adapter, } = options;
    const runtimeAdapter = adapter ?? (await getDefaultAdapter());
    yield* walkDirectory(baseDir, 0, maxDepth, extensions, patterns, ignorePatterns, includeDirs, recursive, followSymlinks, runtimeAdapter);
}
async function* walkDirectory(dir, currentDepth, maxDepth, extensions, patterns, ignorePatterns, includeDirs, recursive, followSymlinks, adapter) {
    if (currentDepth > maxDepth)
        return;
    try {
        const entries = adapter.fs.readDir(dir);
        for await (const entry of entries) {
            if (shouldIgnore(entry.name, ignorePatterns))
                continue;
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory) {
                if (includeDirs) {
                    yield {
                        path: fullPath,
                        name: entry.name,
                        isFile: false,
                        isDirectory: true,
                        depth: currentDepth,
                    };
                }
                if (!recursive)
                    continue;
                yield* walkDirectory(fullPath, currentDepth + 1, maxDepth, extensions, patterns, ignorePatterns, includeDirs, recursive, followSymlinks, adapter);
                continue;
            }
            if (entry.isFile) {
                if (!matchesFile(entry.name, extensions, patterns))
                    continue;
                yield {
                    path: fullPath,
                    name: entry.name,
                    isFile: true,
                    isDirectory: false,
                    depth: currentDepth,
                };
                continue;
            }
            if (!entry.isSymlink || !followSymlinks)
                continue;
            try {
                const stat = await adapter.fs.stat(fullPath);
                if (stat.isDirectory) {
                    if (!recursive)
                        continue;
                    yield* walkDirectory(fullPath, currentDepth + 1, maxDepth, extensions, patterns, ignorePatterns, includeDirs, recursive, followSymlinks, adapter);
                    continue;
                }
                if (!stat.isFile)
                    continue;
                if (!matchesFile(entry.name, extensions, patterns))
                    continue;
                yield {
                    path: fullPath,
                    name: entry.name,
                    isFile: true,
                    isDirectory: false,
                    depth: currentDepth,
                };
            }
            catch {
                // Ignore broken symlinks
            }
        }
    }
    catch {
        // Silently skip missing/inaccessible directories
    }
}
export async function collectFiles(options) {
    return await withSpan("utils.collectFiles", async () => {
        const results = [];
        for await (const file of discoverFiles(options))
            results.push(file);
        return results;
    }, {
        "discovery.baseDir": options.baseDir,
        "discovery.recursive": options.recursive ?? true,
        "discovery.extensions": options.extensions?.join(",") ?? "*",
    });
}
export async function hasMatchingFiles(options) {
    return await withSpan("utils.hasMatchingFiles", async () => {
        for await (const _file of discoverFiles(options))
            return true;
        return false;
    }, {
        "discovery.baseDir": options.baseDir,
        "discovery.patterns": options.patterns?.join(",") ?? "*",
    });
}
export async function countFiles(options) {
    return await withSpan("utils.countFiles", async () => {
        let count = 0;
        for await (const _file of discoverFiles(options))
            count++;
        return count;
    }, {
        "discovery.baseDir": options.baseDir,
    });
}
