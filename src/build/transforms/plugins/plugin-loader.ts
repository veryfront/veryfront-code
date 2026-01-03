import type { Root as HastRoot } from "hast";
import type { Root as MdastRoot } from "mdast";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { getConfig } from "@veryfront/config";
import { serverLogger } from "@veryfront/utils";
import { rehypeAddClasses, rehypeMdxComponents, rehypePreserveNodeIds } from "./rehype-utils.ts";
import { remarkMdxHeadings } from "./remark-headings.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import {
  remarkCodeBlocks,
  remarkMdxImports,
  remarkMdxRemoveParagraphs,
} from "./remark-mdx-utils.ts";
import { remarkAddNodeId } from "./remark-node-id.ts";
import { rehypeMermaid } from "./rehype-mermaid.ts";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";

export type PluginFunction = (
  tree: MdastRoot | HastRoot,
  file?: unknown,
) => void | Promise<void> | ((tree: MdastRoot | HastRoot, file?: unknown) => void);

type PluginEntry = ((...args: unknown[]) => unknown) | [
  ((...args: unknown[]) => unknown),
  ...unknown[],
];

function _validatePlugin(plugin: unknown, index: number): PluginEntry {
  if (typeof plugin === "function") {
    return plugin as ((...args: unknown[]) => unknown);
  }

  if (Array.isArray(plugin)) {
    if (plugin.length === 0) {
      throw toError(createError({
        type: "config",
        message: `Invalid plugin at index ${index}: empty array`,
      }));
    }
    if (typeof plugin[0] !== "function") {
      throw toError(createError({
        type: "config",
        message:
          `Invalid plugin at index ${index}: first element of array must be a function, got ${typeof plugin[
            0
          ]}`,
      }));
    }
    return plugin as [((...args: unknown[]) => unknown), ...unknown[]];
  }

  throw toError(createError({
    type: "config",
    message: `Invalid plugin at index ${index}: must be a function or array, got ${typeof plugin}`,
  }));
}

async function loadUserPlugins(
  projectDir: string,
  adapter: RuntimeAdapter,
  pluginType: "remark" | "rehype",
): Promise<PluginEntry[]> {
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
): Promise<PluginEntry[]> {
  const defaultPlugins: PluginEntry[] = [
    remarkGfm as PluginEntry,
    remarkFrontmatter as PluginEntry,
    remarkAddNodeId as PluginEntry,
    remarkMdxHeadings as PluginEntry,
    remarkMdxRemoveParagraphs as PluginEntry,
    remarkCodeBlocks as PluginEntry,
    remarkMdxImports as PluginEntry,
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
): Promise<PluginEntry[]> {
  const defaultPlugins: PluginEntry[] = [
    rehypeMermaid as PluginEntry, // Must run before rehypeHighlight
    rehypeHighlight as PluginEntry,
    rehypeSlug as PluginEntry,
    rehypePreserveNodeIds as PluginEntry,
    rehypeAddClasses as PluginEntry,
    rehypeMdxComponents as PluginEntry,
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
