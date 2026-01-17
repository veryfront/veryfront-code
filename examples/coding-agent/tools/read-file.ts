/**
 * Read File Tool
 * Reads the contents of a file from the project (works with virtual FS)
 */

import { tool } from "veryfront/tool";
import { z } from "zod";
import { getAdapter } from "@veryfront/platform";
import { resolvePath } from "../utils/path-helpers.ts";

const adapter = await getAdapter();

export default tool({
  description: "Read the contents of a file from the project (works with virtual FS)",
  inputSchema: z.object({
    path: z.string().describe("Relative or absolute path to the file"),
  }),
  execute: async ({ path }) => {
    try {
      const fullPath = resolvePath(path);

      if (!await adapter.fs.exists(fullPath)) {
        return { error: `File not found: ${path}` };
      }

      const stat = await adapter.fs.stat(fullPath);
      if (!stat.isFile) {
        return { error: `Not a file: ${path}` };
      }

      const content = await adapter.fs.readFile(fullPath);

      return {
        content,
        path,
        size: stat.size,
        modified: stat.mtime?.toISOString(),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to read file",
      };
    }
  },
});
