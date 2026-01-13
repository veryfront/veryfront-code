import type { Root as HastRoot } from "hast";
import type { Root as MdastRoot } from "mdast";
import type { Pluggable } from "npm:unified@11";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { getConfig } from "@veryfront/config";
import { serverLogger } from "@veryfront/utils";
import { rehypeAddClasses, rehypeMdxComponents, rehypePreserveNodeIds } from "./rehype-utils.ts";
import { remarkMdxHeadings } from "./remark-headings.ts";
import {
  remarkCodeBlocks,
  remarkMdxImports,
  remarkMdxRemoveParagraphs,
} from "./remark-mdx-utils.ts";
import { remarkAddNodeId as _remarkAddNodeId } from "./remark-node-id.ts";
import { rehypeMermaid } from "./rehype-mermaid.ts";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";

export type PluginFunction = (
  tree: MdastRoot | HastRoot,
  file?: unknown,
) => void | Promise<void> | ((tree: MdastRoot | HastRoot, file?: unknown) => void);

async function loadUserPlugins(
  projectDir: string,
  adapter: RuntimeAdapter,
  pluginType: "remark" | "rehype",
): Promise<Pluggable[]> {
  try {
    const _config = await getConfig(projectDir, adapter);

    return [];
  } catch (error) {
    serverLogger.warn(
      `Failed to load ${pluginType} plugins from config`,
      { error: error instanceof Error ? error.message : String(error) },
    );
    return [];
  }
}

export async function getRemarkPlugins(
  projectDir: string,
  adapter?: RuntimeAdapter,
): Promise<Pluggable[]> {
  // DISABLED: remarkAddNodeId temporarily disabled to fix hydration mismatch.
  // This was adding data-node-id, data-node-line, etc. to MDX elements.
  // Browser modules (via module server) no longer inject positions, so SSR
  // must not inject them either for hydration to succeed.
  // TODO(#studio-navigator): Re-enable with proper SSR/browser synchronization when Studio Navigator
  // is implemented with edit-in-place support.
  const defaultPlugins: Pluggable[] = [
    remarkGfm,
    remarkFrontmatter,
    // remarkAddNodeId,
    remarkMdxHeadings,
    remarkMdxRemoveParagraphs,
    remarkCodeBlocks,
    remarkMdxImports,
  ];

  if (adapter) {
    try {
      const userPlugins = await loadUserPlugins(projectDir, adapter, "remark");
      return [...defaultPlugins, ...userPlugins];
    } catch (error) {
      serverLogger.error(
        "Error loading user remark plugins",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  return defaultPlugins;
}

export async function getRehypePlugins(
  projectDir: string,
  adapter?: RuntimeAdapter,
): Promise<Pluggable[]> {
  const defaultPlugins: Pluggable[] = [
    rehypeMermaid, // Must run before rehypeHighlight
    rehypeHighlight,
    rehypeSlug,
    rehypePreserveNodeIds,
    rehypeAddClasses,
    rehypeMdxComponents,
  ];

  if (adapter) {
    try {
      const userPlugins = await loadUserPlugins(projectDir, adapter, "rehype");
      return [...defaultPlugins, ...userPlugins];
    } catch (error) {
      serverLogger.error(
        "Error loading user rehype plugins",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  return defaultPlugins;
}
