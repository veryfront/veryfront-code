/**
 * Write File Tool
 * Write or update a file in the project (works with virtual FS)
 */

import { tool } from "veryfront/ai";
import { z } from "zod";
import { getAdapter } from "@veryfront/platform";
import { resolvePath } from "../utils/path-helpers.ts";

const adapter = await getAdapter();

export default tool({
  description: "Write or update a file in the project (works with virtual FS)",
  inputSchema: z.object({
    path: z.string().describe("Relative or absolute path to the file"),
    content: z.string().describe("Content to write to the file"),
  }),
  execute: async ({ path, content }) => {
    try {
      const fullPath = resolvePath(path);

      // Create parent directory if it doesn't exist
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      if (parentDir && !await adapter.fs.exists(parentDir)) {
        await adapter.fs.mkdir(parentDir, { recursive: true });
      }

      await adapter.fs.writeFile(fullPath, content);

      return {
        success: true,
        path,
        size: content.length,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to write file",
      };
    }
  },
});
