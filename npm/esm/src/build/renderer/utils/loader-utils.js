const EXTENSION_MAP = {
    mdx: "mdx",
    tsx: "tsx",
    ts: "ts",
    jsx: "jsx",
    js: "js",
    mjs: "js",
    css: "css",
    json: "json",
};
const LOADER_MAP = {
    mdx: "tsx", // MDX compiles to TSX
    tsx: "tsx",
    ts: "ts",
    jsx: "jsx",
    js: "js",
    mjs: "js",
    css: "css",
    json: "json",
};
function getExtension(path) {
    return path.split(".").pop()?.toLowerCase() ?? "";
}
export function getLoaderFromPath(path) {
    return LOADER_MAP[getExtension(path)] ?? "default";
}
export function getFileType(path) {
    return EXTENSION_MAP[getExtension(path)] ?? "js";
}
export function getSlugFromPath(path) {
    return path
        .replace(/^\.\//, "")
        .replace(/\.(mdx|tsx|ts|jsx|js)$/, "")
        .replace(/\/index$/, "")
        .replace(/[^a-zA-Z0-9-/]/g, "-")
        .toLowerCase();
}
