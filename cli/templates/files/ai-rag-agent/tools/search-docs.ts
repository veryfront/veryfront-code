import { tool } from "veryfront/tool";
import { z } from "zod";
import { store } from "../store.ts";

export default tool({
  id: "search-docs",
  description:
    "Search documents in the knowledge base using semantic similarity. " +
    "Phrase queries naturally rather than using single keywords for best results.",
  inputSchema: z.object({
    query: z.string().describe("Natural language search query"),
  }),
  execute: async ({ query }) => {
    await store.indexContentDir();

    const results = await store.search(query, { topK: 5 });

    return {
      documents: results.map(({ title, text, score }) => ({
        title,
        content: text,
        score,
      })),
    };
  },
});
