/**
 * Web Search Tool
 * Search the web for documentation, examples, or latest information using Brave Search API
 */

import { tool } from "veryfront/ai";
import { z } from "zod";

export default tool({
  description: "Search the web for documentation, examples, or latest information",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    count: z.number().optional().default(5).describe("Number of results to return (1-10)"),
  }),
  execute: async ({ query, count }) => {
    const apiKey = Deno.env.get("BRAVE_SEARCH_API_KEY");

    if (!apiKey) {
      return {
        error: "Web search not configured. Set BRAVE_SEARCH_API_KEY in .env",
        suggestion: "Get a free API key at https://brave.com/search/api/ (2000 queries/month free)",
      };
    }

    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${
          Math.min(count, 10)
        }`,
        {
          headers: {
            "Accept": "application/json",
            "X-Subscription-Token": apiKey,
          },
        },
      );

      if (!response.ok) {
        return { error: `Search failed: ${response.statusText}` };
      }

      const data = await response.json();

      return {
        query,
        results: data.web?.results?.map((r: any) => ({
          title: r.title,
          url: r.url,
          description: r.description,
        })) || [],
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Search failed",
      };
    }
  },
});
