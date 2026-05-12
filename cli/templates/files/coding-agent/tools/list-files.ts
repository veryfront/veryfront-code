import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { readDir, resolve, cwd } from "veryfront/fs";

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
  execute: async ({ directory, extensions }) => {
    const absolute = resolve(cwd(), directory);
    const entries = await readDir(absolute);

    let files = entries
      .filter((e) => e.isFile)
      .map((e) => e.name);

    if (extensions?.length) {
      files = files.filter((f) =>
        extensions.some((ext) => f.endsWith(ext))
      );
    }

    return { directory, files, count: files.length };
  },
});
