import { tool } from "veryfront/tool";
import { z } from "zod";
import { readTextFile, writeTextFile, resolve, cwd } from "veryfront/fs";

export default tool({
  id: "edit-file",
  description: "Edit a file by replacing a specific string with new content",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the project root"),
    search: z.string().describe("Exact string to find in the file"),
    replace: z.string().describe("String to replace it with"),
  }),
  execute: async ({ path, search, replace }) => {
    const absolute = resolve(cwd(), path);

    let content: string;
    try {
      content = await readTextFile(absolute);
    } catch {
      return { error: `File not found: ${path}` };
    }

    if (!content.includes(search)) {
      return { error: "Search string not found in file" };
    }

    const updated = content.replace(search, replace);
    await writeTextFile(absolute, updated);
    return { path, success: true };
  },
});
