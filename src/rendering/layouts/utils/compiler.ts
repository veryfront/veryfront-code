import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "@veryfront/types";

export async function compileMDXLayouts(
  layouts: LayoutItem[],
  compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>,
  adapter: RuntimeAdapter,
): Promise<void> {
  for (const layout of layouts) {
    if (layout.kind === "mdx" && layout.path && !layout.bundle) {
      const content = await adapter.fs.readFile(layout.path);
      const bundle = await compileMDX(content, { isLayout: true }, layout.path);
      layout.bundle = bundle;
    }
  }
}
