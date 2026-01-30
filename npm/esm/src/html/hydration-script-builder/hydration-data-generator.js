import { resolveRelativePath } from "../../modules/react-loader/path-resolver.js";
import { getExtensionName } from "../../utils/path-utils.js";
function toProjectRelativePath(absolutePath, projectDir) {
    if (!absolutePath)
        return "";
    const normalizedPath = absolutePath.replace(/\\/g, "/");
    if (!projectDir)
        return normalizedPath.replace(/^\//, "");
    return resolveRelativePath(normalizedPath, projectDir);
}
const PAGE_TYPE_EXTENSIONS = new Set(["mdx", "tsx", "jsx", "ts", "js"]);
function inferPageType(pagePath) {
    if (!pagePath)
        return undefined;
    const ext = getExtensionName(pagePath);
    if (!ext)
        return undefined;
    return PAGE_TYPE_EXTENSIONS.has(ext) ? ext : undefined;
}
export function generateHydrationData(slug, params, props, options) {
    const layouts = (options.nestedLayouts ?? [])
        .map((layout) => ({
        kind: layout.kind,
        path: toProjectRelativePath(layout.path ?? layout.componentPath ?? "", options.projectDir),
    }))
        .filter((layout) => layout.path);
    const data = {
        slug: slug || "",
        props: props || {},
        params: params || {},
        layouts,
        appPath: options.appPath
            ? toProjectRelativePath(options.appPath, options.projectDir)
            : undefined,
        pagePath: options.pagePath
            ? toProjectRelativePath(options.pagePath, options.projectDir)
            : undefined,
        pageType: options.pageType || inferPageType(options.pagePath),
        frontmatter: options.frontmatter,
        layoutProps: options.layoutProps,
        // In dev mode, client uses createRoot instead of hydrateRoot to avoid
        // hydration mismatches from compilation differences between SSR and client
        dev: options.mode === "development",
        headings: options.headings,
        studioEmbed: options.studioEmbed,
    };
    return JSON.stringify(data, null, 2);
}
