import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { readTextFile, resolve, cwd } from "veryfront/fs";

export default tool({
  id: "read-file",
  description: "Read the contents of a file in the project",
  inputSchema: defineSchema((v) => v.object({
    path: v.string().describe("File path relative to the project root"),
  }))(),
  execute: async ({ path }) => {
    const projectDir = resolve(cwd());
    const absolute = resolve(projectDir, path);
    // Keep file access inside the project directory — reject traversal like
    // "../../etc/passwd" before touching the filesystem.
    if (absolute !== projectDir && !absolute.startsWith(projectDir + "/")) {
      return { error: `Path escapes project directory: ${path}` };
    }
    try {
      const content = await readTextFile(absolute);
      return { path, content };
    } catch {
      return { error: `File not found: ${path}` };
    }
  },
});
