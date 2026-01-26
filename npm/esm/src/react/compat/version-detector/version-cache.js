import { detectReactVersion, detectReactVersionFromProject } from "./feature-detector.js";
let defaultVersionInfo = null;
const projectVersionCache = new Map();
export function getReactVersionInfo() {
    defaultVersionInfo ??= detectReactVersion();
    return defaultVersionInfo;
}
export async function getReactVersionInfoForProject(projectDir) {
    const cached = projectVersionCache.get(projectDir);
    if (cached)
        return cached;
    const info = await detectReactVersionFromProject(projectDir);
    projectVersionCache.set(projectDir, info);
    return info;
}
export function clearProjectVersionCache(projectDir) {
    projectVersionCache.delete(projectDir);
}
export function hasFeature(feature) {
    return getReactVersionInfo().features[feature];
}
export function __resetReactVersionCacheForTests() {
    defaultVersionInfo = null;
    projectVersionCache.clear();
}
