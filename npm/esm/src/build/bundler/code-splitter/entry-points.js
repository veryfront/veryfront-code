/**
 * Entry point creation and path conversion utilities
 * @module code-splitter/entry-points
 */
export function createEntryPoints(routes) {
    const entryPoints = {};
    const routeMap = new Map();
    for (const { name, path, file } of routes) {
        const entryName = name ?? convertPathToName(path);
        entryPoints[entryName] = file;
        routeMap.set(entryName, path);
    }
    return { entryPoints, routeMap };
}
export function convertPathToName(path) {
    if (path === "/")
        return "index";
    return path.replace(/^\//, "").replaceAll("/", "-");
}
