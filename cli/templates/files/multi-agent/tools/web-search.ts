import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  id: "web-search",
  description: "Search the web for information on a topic",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query }) => {
    // Replace with a real search API (e.g., Tavily, SerpAPI, Brave Search)
    return {
      results: [
        {
          title: `Results for: ${query}`,
          snippet:
            "Connect a search API to get real results. " +
            "See https://veryfront.com/code/guides/tools for setup instructions.",
          url: "https://veryfront.com/code/guides/tools",
        },
      ],
    };
  },
});
