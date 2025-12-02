import { tool } from "../../../../src/ai/index.ts";
import { z } from "zod";

export default tool({
  id: "indexDocument",
  description: "Index a processed document.",
  inputSchema: z.object({
    docId: z.string(),
    data: z.record(z.any()),
  }),
  execute: async ({ docId, data }) => {
    console.log(`[Indexer] Indexing document ${docId}...`);
    return { indexed: true, docId };
  },
});
