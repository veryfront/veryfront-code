import { tool } from "veryfront/tool";
import { z } from "zod";
import { readTextFile, readDir, join, extname } from "veryfront/fs";

const CONTENT_DIR = "content";
const ALLOWED_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);

async function listContentFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  for await (const entry of readDir(dir)) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory) {
      files.push(...(await listContentFiles(fullPath)));
    } else if (entry.isFile && ALLOWED_EXTENSIONS.has(extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

export default tool({
  id: "search-docs",
  description: "Search documents in the knowledge base for relevant content",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query }) => {
    const files = await listContentFiles(CONTENT_DIR);
    const results: Array<{ title: string; content: string; relevance: number }> = [];
    const queryTerms = query.toLowerCase().split(/\s+/);

    for (const file of files) {
      const content = await readTextFile(file);
      if (!content) continue;

      const lower = content.toLowerCase();
      const relevance = queryTerms.filter((term) => lower.includes(term)).length / queryTerms.length;

      if (relevance > 0) {
        const title = file.replace(/^content\//, "").replace(/\.(md|mdx|txt)$/, "");
        results.push({ title, content: content.slice(0, 2000), relevance });
      }
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return { documents: results.slice(0, 3) };
  },
});
