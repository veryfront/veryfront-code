import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { cwd, readTextFile, realPath, resolve } from "veryfront/fs";

/** True when `target` is the same as, or nested under, `root` (both canonical). */
function isWithin(root: string, target: string): boolean {
  const r = root.replace(/\\/g, "/");
  const t = target.replace(/\\/g, "/");
  return t === r || t.startsWith(`${r}/`);
}

export default tool({
  id: "read-file",
  description: "Read the contents of a file in the project",
  inputSchema: defineSchema((v) => v.object({
    path: v.string().describe("File path relative to the project root"),
  }))(),
  execute: async ({ path }) => {
    let projectDir: string;
    let absolute: string;
    try {
      // Canonicalize both sides so a symlink that points outside the project
      // is resolved to its real target before the containment check.
      projectDir = await realPath(cwd());
      absolute = await realPath(resolve(projectDir, path));
    } catch {
      return { error: `File not found: ${path}` };
    }
    if (!isWithin(projectDir, absolute)) {
      return { error: `Path escapes project directory: ${path}` };
    }
    const content = await readTextFile(absolute);
    return { path, content };
  },
});
