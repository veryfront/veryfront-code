import * as dntShim from "../../../../_dnt.shims.js";
import { rendererLogger as logger } from "../../../utils/index.js";
import { generateHash } from "./cache.js";
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function rewriteEsmPaths(code, urlBase) {
    const resolveAbsolute = (path) => `https://esm.sh${path}`;
    const resolveRelative = (path) => new URL(path, urlBase).href;
    const patterns = [
        [/import\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
        [/from\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
        [/export\s*\*\s*from\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
        [/export\s*\{([^}]+)\}\s*from\s*(["'])(\/[^"']+)\2/g, 3, resolveAbsolute],
        [/import\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
        [/from\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
        [/export\s*\*\s*from\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
        [/export\s*\{([^}]+)\}\s*from\s*(["'])(\.\.?\/[^"']+)\2/g, 3, resolveRelative],
    ];
    let result = code;
    for (const [pattern, pathIndex, resolver] of patterns) {
        result = result.replace(pattern, (...args) => {
            const match = args[0];
            const path = args[pathIndex - 1];
            const quote = (pathIndex === 3 ? args[2] : args[1]);
            const resolved = resolver(path);
            const pathPattern = new RegExp(`${quote}${escapeRegExp(path)}${quote}`);
            return match.replace(pathPattern, `${quote}${resolved}${quote}`);
        });
    }
    return result;
}
export async function fetchEsmModule(url, tmpDir, localAdapter, esmCache) {
    const cached = esmCache.get(url);
    if (cached)
        return cached;
    logger.debug("[ModuleLoader] Fetching esm.sh module:", url);
    const response = await dntShim.fetch(url);
    if (!response.ok)
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
    let code = await response.text();
    const urlBase = url.substring(0, url.lastIndexOf("/") + 1);
    code = rewriteEsmPaths(code, urlBase);
    const allEsmUrls = new Set();
    const urlPattern = /["'](https:\/\/esm\.sh\/[^"']+)["']/g;
    for (let match = urlPattern.exec(code); match !== null; match = urlPattern.exec(code)) {
        allEsmUrls.add(match[1]);
    }
    const urlArray = Array.from(allEsmUrls);
    const cachedPaths = await Promise.all(urlArray.map((esmUrl) => fetchEsmModule(esmUrl, tmpDir, localAdapter, esmCache)));
    if (urlArray.length) {
        const replacementMap = new Map();
        for (let i = 0; i < urlArray.length; i++) {
            replacementMap.set(urlArray[i], `file://${cachedPaths[i]}`);
        }
        const combinedPattern = new RegExp(urlArray.map(escapeRegExp).join("|"), "g");
        code = code.replace(combinedPattern, (m) => replacementMap.get(m) ?? m);
    }
    const hash = await generateHash(url);
    const tempFilePath = `${tmpDir}/esm-${hash}.js`;
    await localAdapter.fs.writeFile(tempFilePath, code);
    esmCache.set(url, tempFilePath);
    return tempFilePath;
}
