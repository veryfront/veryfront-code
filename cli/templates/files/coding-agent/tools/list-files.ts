import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { cwd, readDir, realPath, resolve } from "veryfront/fs";

/** True when `target` is the same as, or nested under, `root` (both canonical). */
function isWithin(root: string, target: string): boolean {
  const r = root.replace(/\\/g, "/");
  const t = target.replace(/\\/g, "/");
  return t === r || t.startsWith(`${r}/`);
}

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
    let projectDir: string;
    let absolute: string;
    try {
      // Canonicalize both sides so a symlink that points outside the project
      // is resolved to its real target before the containment check.
      projectDir = await realPath(cwd());
      absolute = await realPath(resolve(projectDir, directory));
    } catch {
      return { error: `Directory not found: ${directory}` };
    }
    if (!isWithin(projectDir, absolute)) {
      return { error: `Path escapes project directory: ${directory}` };
    }

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
