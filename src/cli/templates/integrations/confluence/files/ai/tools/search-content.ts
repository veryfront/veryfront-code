import { tool } from "veryfront/tool";
import { z } from "zod";
import { searchContent } from "../../lib/confluence-client.ts";

export default tool({
  id: "search-content",
  description:
    "Search for pages and blog posts in Confluence. Returns matching content with titles, excerpts, and links.",
  inputSchema: z.object({
    query: z.string().describe("Search query to find pages or blog posts"),
    spaceKey: z.string().optional().describe(
      "Optional space key to limit search to a specific space",
    ),
    limit: z.number().min(1).max(50).default(10).describe("Maximum number of results to return"),
  }),
  async execute({ query, spaceKey, limit }) {
    const results = await searchContent(query, {
      spaceKey,
      limit,
    });

    return results.map((result) => ({
      id: result.content.id,
      type: result.content.type,
      title: result.content.title,
      excerpt: result.excerpt,
      url: result.url,
      space: result.content.space
        ? {
          id: result.content.space.id,
          key: result.content.space.key,
          name: result.content.space.name,
        }
        : undefined,
      lastUpdated: result.content.history?.lastUpdated.when,
    }));
  },
});
