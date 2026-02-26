import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  id: "search",
  description: "Search your knowledge base",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query }) => {
    // Replace with your domain-specific search logic
    return {
      results: [],
      query,
      message: "Connect your data source for real results.",
    };
  },
});
