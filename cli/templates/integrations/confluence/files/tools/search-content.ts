import { tool } from "veryfront/tool";
import { z } from "zod";
import { searchContent } from "../../lib/confluence-client.ts";

export default tool({
  id: "search-content",
  description:
    "Search for pages and blog posts in Confluence. Returns matching content with titles, excerpts, and links.",
  inputSchema: z.object({
    query: z.string().describe("Search query to find pages or blog posts"),
    spaceKey: z
      .string()
      .optional()
      .describe("Optional space key to limit search to a specific space"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of results to return"),
  }),
  async execute({ query, spaceKey, limit }) {
    const results = await searchContent(query, { spaceKey, limit });

    return results.map((result) => {
      const { content, excerpt, url } = result;
      const space = content.space;

      return {
        id: content.id,
        type: content.type,
        title: content.title,
        excerpt,
        url,
        space: space
          ? {
              id: space.id,
              key: space.key,
              name: space.name,
            }
          : undefined,
        lastUpdated: content.history?.lastUpdated.when,
      };
    });
  },
});
