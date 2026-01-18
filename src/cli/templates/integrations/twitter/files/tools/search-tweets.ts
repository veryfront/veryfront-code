import { tool } from "veryfront/tool";
import { z } from "zod";
import { createTwitterClient } from "../../lib/twitter-client.ts";

export default tool({
  id: "search-tweets",
  description:
    "Search recent tweets on Twitter/X. Returns up to 10 recent tweets matching the query.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        "Search query (supports Twitter search operators like 'from:', 'to:', '#hashtag', etc.)",
      ),
    maxResults: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum number of tweets to return (default: 10)"),
    sortOrder: z
      .enum(["recency", "relevancy"])
      .optional()
      .describe("Sort order: 'recency' (default) or 'relevancy'"),
  }),
  execute: async ({ query, maxResults, sortOrder }, context) => {
    // Default to "current-user" for development; in production, always pass userId from session
    const userId = (context?.userId as string | undefined) || "current-user";

    try {
      const twitter = createTwitterClient(userId);
      const result = await twitter.searchTweets(query, {
        maxResults: maxResults || 10,
        sortOrder: sortOrder || "recency",
      });

      if (!result.data || result.data.length === 0) {
        return {
          success: true,
          tweets: [],
          count: 0,
          message: `No tweets found matching query: "${query}"`,
        };
      }

      return {
        success: true,
        tweets: result.data.map((tweet) => ({
          id: tweet.id,
          text: tweet.text,
          author_id: tweet.author_id,
          created_at: tweet.created_at,
          metrics: tweet.public_metrics,
          hashtags: tweet.entities?.hashtags?.map((h) => h.tag),
          mentions: tweet.entities?.mentions?.map((m) => m.username),
        })),
        count: result.meta.result_count,
        message: `Found ${result.meta.result_count} tweets matching query: "${query}"`,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "Twitter not connected. Please connect your Twitter account.",
          connectUrl: "/api/auth/twitter",
        };
      }
      throw error;
    }
  },
});
