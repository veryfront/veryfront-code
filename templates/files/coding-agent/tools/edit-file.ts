import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { notFoundMessage, projectFiles } from "../lib/project-files.ts";

export default tool({
  id: "edit-file",
  description: "Edit a file by replacing a specific string with new content",
  inputSchema: defineSchema((v) => v.object({
    path: v.string().describe("File path relative to the project root"),
    search: v.string().describe("Exact string to find in the file"),
    replace: v.string().describe("String to replace it with"),
  }))(),
  // On Veryfront Cloud the project's files are read and saved through these platform operations.
  delegatedPlatformTools: ["veryfront__get_file", "veryfront__update_file"],
  execute: async ({ path, search, replace }, context) => {
    const source = projectFiles(context);
    const file = await source.read(path);
    if ("escapes" in file) {
      return { error: `Path escapes project directory: ${path}` };
    }
    if ("notFound" in file) {
      return { error: await notFoundMessage(source, `File not found: ${path}`) };
    }

    if (!file.content.includes(search)) {
      return { error: "Search string not found in file" };
    }

    await source.write(path, file.content.replace(search, replace));
    return { path, success: true };
  },
});
