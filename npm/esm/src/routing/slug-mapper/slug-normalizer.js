export function normalizeSlug(slug) {
    return slug
        .split("/")
        .filter(Boolean)
        .join("/");
}
export function slugToPath(slug) {
    const normalized = normalizeSlug(slug);
    return normalized ? `/${normalized}` : "/";
}
export function pathToSlug(path) {
    return normalizeSlug(path.replace(/^\//, ""));
}
export function getSlugFromPath(filePath) {
    const parts = filePath.split("/");
    const fileName = parts.at(-1) ?? "";
    const slug = fileName.replace(/\.(mdx?|tsx?|jsx?|ts|js)$/, "");
    if (slug !== "index" && slug !== "page")
        return slug;
    const parentDir = parts.at(-2) ?? "";
    return parentDir === "pages" || parentDir === "app" ? "" : parentDir;
}
