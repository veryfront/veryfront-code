import * as dntShim from "../../_dnt.shims.js";
import { computeHash } from "./hash-utils.js";
import { serverLogger as logger } from "./logger/index.js";
import { createFileSystem } from "../platform/compat/fs.js";
const LOCKFILE_NAME = "veryfront.lock";
const LOCKFILE_VERSION = 1;
export function createEmptyLockfile() {
    return { version: LOCKFILE_VERSION, imports: {} };
}
export async function computeIntegrity(content) {
    const hash = await computeHash(content);
    return `sha256-${hash}`;
}
export async function verifyIntegrity(content, integrity) {
    const computed = await computeIntegrity(content);
    return computed === integrity;
}
function createPlatformFSAdapter() {
    const fs = createFileSystem();
    return {
        readFile(path) {
            return fs.readTextFile(path);
        },
        writeFile(path, content) {
            return fs.writeTextFile(path, content);
        },
        exists(path) {
            return fs.exists(path);
        },
        remove(path) {
            return fs.remove(path);
        },
    };
}
export function createLockfileManager(projectDir, fsAdapter) {
    const fs = fsAdapter ?? createPlatformFSAdapter();
    const lockfilePath = `${projectDir}/${LOCKFILE_NAME}`;
    let cache = null;
    let dirty = false;
    async function read() {
        if (cache)
            return cache;
        try {
            if (!(await fs.exists(lockfilePath)))
                return null;
            const content = await fs.readFile(lockfilePath);
            cache = JSON.parse(content);
            if (cache.version !== LOCKFILE_VERSION) {
                logger.warn(`[lockfile] Version mismatch, expected ${LOCKFILE_VERSION}, got ${cache.version}`);
                cache = createEmptyLockfile();
            }
            return cache;
        }
        catch (e) {
            logger.debug(`[lockfile] Could not read lockfile: ${e}`);
            return null;
        }
    }
    async function write(data) {
        cache = data;
        const sorted = {
            version: data.version,
            imports: Object.fromEntries(Object.entries(data.imports).sort(([a], [b]) => a.localeCompare(b))),
        };
        await fs.writeFile(lockfilePath, JSON.stringify(sorted, null, 2) + "\n");
        dirty = false;
        logger.debug(`[lockfile] Written ${Object.keys(data.imports).length} entries`);
    }
    async function get(url) {
        const data = await read();
        return data?.imports[url] ?? null;
    }
    async function set(url, entry) {
        const data = (await read()) ?? createEmptyLockfile();
        data.imports[url] = entry;
        cache = data;
        dirty = true;
    }
    async function has(url) {
        const data = await read();
        return url in (data?.imports ?? {});
    }
    async function clear() {
        cache = createEmptyLockfile();
        dirty = false;
        if (!fs.remove)
            return;
        if (!(await fs.exists(lockfilePath)))
            return;
        await fs.remove(lockfilePath);
    }
    async function flush() {
        if (!dirty || !cache)
            return;
        await write(cache);
    }
    return { read, write, get, set, has, clear, flush };
}
const USER_AGENT_HEADERS = { "user-agent": "Mozilla/5.0 Veryfront/1.0" };
export async function fetchWithLock(options) {
    const { lockfile, url, fetchFn = dntShim.fetch, strict = false } = options;
    const entry = await lockfile.get(url);
    if (entry) {
        logger.debug(`[lockfile] Cache hit for ${url}`);
        const res = await fetchFn(entry.resolved, { headers: USER_AGENT_HEADERS });
        if (!res.ok) {
            if (strict) {
                throw new Error(`Lockfile entry stale: ${url} resolved to ${entry.resolved} returned ${res.status}`);
            }
            logger.warn(`[lockfile] Cached URL ${entry.resolved} returned ${res.status}, refetching`);
        }
        else {
            const content = await res.text();
            const currentIntegrity = await computeIntegrity(content);
            if (currentIntegrity === entry.integrity) {
                return {
                    content,
                    resolvedUrl: entry.resolved,
                    fromCache: true,
                    integrity: entry.integrity,
                };
            }
            if (strict) {
                throw new Error(`Integrity mismatch for ${url}: expected ${entry.integrity}, got ${currentIntegrity}`);
            }
            logger.warn(`[lockfile] Integrity mismatch for ${url}, updating lockfile`);
        }
    }
    logger.debug(`[lockfile] Fetching fresh: ${url}`);
    const res = await fetchFn(url, { headers: USER_AGENT_HEADERS, redirect: "follow" });
    if (!res.ok)
        throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const content = await res.text();
    const resolvedUrl = res.url || url;
    const integrity = await computeIntegrity(content);
    await lockfile.set(url, {
        resolved: resolvedUrl,
        integrity,
        fetchedAt: new Date().toISOString(),
    });
    await lockfile.flush();
    return { content, resolvedUrl, fromCache: false, integrity };
}
const IMPORT_REGEX = /import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_REGEX = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_FROM_REGEX = /export\s+(?:[\w*\s{},]*)\s+from\s+['"]([^'"]+)['"]/g;
export function extractImports(content) {
    const imports = [];
    const seen = new Set();
    function addMatches(regex, type) {
        for (const match of content.matchAll(regex)) {
            const specifier = match[1];
            if (!specifier || seen.has(specifier))
                continue;
            seen.add(specifier);
            imports.push({ specifier, type });
        }
    }
    addMatches(IMPORT_REGEX, "static");
    addMatches(EXPORT_FROM_REGEX, "static");
    addMatches(DYNAMIC_IMPORT_REGEX, "dynamic");
    return imports;
}
export function resolveImportUrl(specifier, baseUrl) {
    if (specifier.startsWith("http://") || specifier.startsWith("https://"))
        return specifier;
    if (!specifier.startsWith("./") && !specifier.startsWith("../"))
        return null;
    try {
        return new URL(specifier, baseUrl).toString();
    }
    catch {
        return null;
    }
}
