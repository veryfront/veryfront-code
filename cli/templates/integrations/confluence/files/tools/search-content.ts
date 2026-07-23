import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createConfluenceClient } from "../lib/confluence-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "search-content",
  description:
    "Search for pages and blog posts in Confluence. Returns matching content with titles, excerpts, and links.",
  inputSchema: defineSchema((v) =>
    v.object({
      query: v.string().describe("Search query to find pages or blog posts"),
      spaceKey: v
        .string()
        .optional()
        .describe("Optional space key to limit search to a specific space"),
      limit: v
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum number of results to return"),
    })
  )(),
  async execute({ query, spaceKey, limit }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createConfluenceClient(userId);
    const results = await client.searchContent(query, { spaceKey, limit });

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
