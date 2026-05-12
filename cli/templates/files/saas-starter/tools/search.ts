import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";

export default tool({
  id: "search",
  description: "Search your knowledge base",
  inputSchema: defineSchema((v) => v.object({
    query: v.string().describe("Search query"),
  }))(),
  execute: async ({ query }) => {
    // Replace with your domain-specific search logic
    return {
      results: [],
      query,
      message: "Connect your data source for real results.",
    };
  },
});
