/**
 * List Files Tool
 * List files and directories in a path (works with virtual FS)
 */

import { tool } from "veryfront/ai";
import { z } from "zod";
import { getAdapter } from "@veryfront/platform";
import { resolvePath } from "../utils/path-helpers.ts";

const adapter = await getAdapter();

export default tool({
  description: "List files and directories in a path (works with virtual FS)",
  inputSchema: z.object({
    path: z.string().describe('Directory path (relative to project root, use "." for root)'),
    recursive: z.boolean().optional().default(false).describe("List files recursively"),
  }),
  execute: async ({ path, recursive }) => {
    try {
      const fullPath = resolvePath(path);

      if (!await adapter.fs.exists(fullPath)) {
        return { error: `Directory not found: ${path}` };
      }

      const stat = await adapter.fs.stat(fullPath);
      if (!stat.isDirectory) {
        return { error: `Not a directory: ${path}` };
      }

      const files: Array<{ path: string; type: string; size?: number }> = [];

      const scan = async (dir: string, prefix = "") => {
        for await (const entry of adapter.fs.readDir(dir)) {
          // Skip hidden files and node_modules
          if (entry.name.startsWith(".") || entry.name === "node_modules") {
            continue;
          }

          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
          const entryPath = `${dir}/${entry.name}`;

          if (entry.isFile) {
            const entryStat = await adapter.fs.stat(entryPath);
            files.push({
              path: relativePath,
              type: "file",
              size: entryStat.size,
            });
          } else if (entry.isDirectory) {
            files.push({ path: relativePath, type: "directory" });
            if (recursive) {
              await scan(entryPath, relativePath);
            }
          }
        }
      };

      await scan(fullPath);

      return { files, count: files.length };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to list files",
      };
    }
  },
});
