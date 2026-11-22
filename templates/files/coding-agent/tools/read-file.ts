import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { notFoundMessage, projectFiles } from "../lib/project-files.ts";

export default tool({
  id: "read-file",
  description: "Read the contents of a file in the project",
  inputSchema: defineSchema((v) => v.object({
    path: v.string().describe("File path relative to the project root"),
  }))(),
  // On Veryfront Cloud the project's files are read through this platform operation.
  delegatedPlatformTools: ["veryfront__get_file"],
  execute: async ({ path }, context) => {
    const source = projectFiles(context);
    const file = await source.read(path);
    if ("escapes" in file) {
      return { error: `Path escapes project directory: ${path}` };
    }
    if ("notFound" in file) {
      return { error: await notFoundMessage(source, `File not found: ${path}`) };
    }
    return { path, content: file.content };
  },
});
