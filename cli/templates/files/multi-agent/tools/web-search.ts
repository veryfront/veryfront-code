import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  id: "web-search",
  description: "Search the web for information on a topic",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
  }),
  execute: async ({ query: _query }) => {
    // Connect a real search API to use this tool.
    // Popular options: Tavily, SerpAPI, Brave Search
    throw new Error(
      "No search API configured. " +
        "See https://veryfront.com/code/guides/tools for setup instructions.",
    );
  },
});
