import { parallelMap } from "../../../utils/index.js";
export async function compileMDXLayouts(layouts, compileMDX, adapter) {
    const mdxLayouts = layouts.filter((layout) => layout.kind === "mdx" && layout.path && !layout.bundle);
    if (mdxLayouts.length === 0)
        return;
    const bundles = await parallelMap(mdxLayouts, async (layout) => {
        const path = layout.path;
        const content = await adapter.fs.readFile(path);
        const bundle = await compileMDX(content, { isLayout: true }, path);
        return { layout, bundle };
    });
    for (const { layout, bundle } of bundles) {
        layout.bundle = bundle;
    }
}
