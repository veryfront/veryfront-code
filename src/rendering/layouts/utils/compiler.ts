import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "@veryfront/types";
import { parallelMap } from "@veryfront/utils";

export async function compileMDXLayouts(
  layouts: LayoutItem[],
  compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>,
  adapter: RuntimeAdapter,
): Promise<void> {
  // Filter to only MDX layouts that need compilation
  const mdxLayouts = layouts.filter(
    (layout) => layout.kind === "mdx" && layout.path && !layout.bundle,
  );

  // Compile all MDX layouts in parallel with concurrency control
  const bundles = await parallelMap(mdxLayouts, async (layout) => {
    const content = await adapter.fs.readFile(layout.path!);
    const bundle = await compileMDX(content, { isLayout: true }, layout.path);
    return { layout, bundle };
  });

  // Apply bundles back to layouts
  for (const { layout, bundle } of bundles) {
    layout.bundle = bundle;
  }
}
