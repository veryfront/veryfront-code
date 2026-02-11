import { tool } from "veryfront/tool";
import { z } from "zod";
import { readTextFile, resolve, cwd } from "veryfront/fs";

export default tool({
  id: "read-file",
  description: "Read the contents of a file in the project",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the project root"),
  }),
  execute: async ({ path }) => {
    try {
      const absolute = resolve(cwd(), path);
      const content = await readTextFile(absolute);
      return { path, content };
    } catch {
      return { error: `File not found: ${path}` };
    }
  },
});
