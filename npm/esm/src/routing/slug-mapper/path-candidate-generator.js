import { join } from "../../platform/compat/path-helper.js";
const SUPPORTED_EXTENSIONS = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"];
function withExtensions(basePath, filename) {
    return SUPPORTED_EXTENSIONS.map((ext) => `${basePath}/${filename}${ext}`);
}
function withJoinedExtensions(basePath, filenameWithExtBase) {
    return SUPPORTED_EXTENSIONS.map((ext) => join(basePath, `${filenameWithExtBase}${ext}`));
}
export function generateAppRouterCandidates(projectDir, normalizedSlug) {
    const appBase = join(projectDir, "app");
    if (!normalizedSlug)
        return withExtensions(appBase, "page");
    const slugBase = join(appBase, normalizedSlug);
    return [
        ...withExtensions(slugBase, "page"),
        ...SUPPORTED_EXTENSIONS.map((ext) => `${slugBase}${ext}`),
    ];
}
export function generatePagesRouterCandidates(projectDir, normalizedSlug) {
    const pagesBase = join(projectDir, "pages");
    const isIndex = normalizedSlug === "" || normalizedSlug === "index";
    if (isIndex) {
        return [
            ...withExtensions(pagesBase, "index"),
            ...withExtensions(projectDir, "index"),
        ];
    }
    return [
        ...withJoinedExtensions(pagesBase, normalizedSlug),
        ...withExtensions(join(pagesBase, normalizedSlug), "index"),
        ...withJoinedExtensions(projectDir, normalizedSlug),
    ];
}
export function getPathCandidates(projectDir, slug) {
    const normalizedSlug = slug ?? "";
    return {
        appRouter: generateAppRouterCandidates(projectDir, normalizedSlug),
        pagesRouter: generatePagesRouterCandidates(projectDir, normalizedSlug),
    };
}
export function getSupportedExtensions() {
    return [...SUPPORTED_EXTENSIONS];
}
