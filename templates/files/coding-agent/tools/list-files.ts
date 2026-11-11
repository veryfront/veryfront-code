import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { notFoundMessage, projectFiles } from "../lib/project-files.ts";

export default tool({
  id: "list-files",
  description: "List files in a project directory",
  inputSchema: defineSchema((v) => v.object({
    directory: v
      .string()
      .default(".")
      .describe("Directory path relative to project root"),
    extensions: v
      .array(v.string())
      .optional()
      .describe("Filter by file extensions (e.g. ['.ts', '.tsx'])"),
  }))(),
  // On Veryfront Cloud the project's files are read through this platform operation.
  delegatedPlatformTools: ["veryfront__list_files"],
  execute: async ({ directory, extensions }, context) => {
    const source = projectFiles(context);
    const listing = await source.list(directory);
    if ("escapes" in listing) {
      return { error: `Path escapes project directory: ${directory}` };
    }
    if ("notFound" in listing) {
      return { error: await notFoundMessage(source, `Directory not found: ${directory}`) };
    }

    let files = listing.files;
    if (extensions?.length) {
      files = files.filter((file) => extensions.some((ext) => file.endsWith(ext)));
    }

    return { directory, files, count: files.length };
  },
});
