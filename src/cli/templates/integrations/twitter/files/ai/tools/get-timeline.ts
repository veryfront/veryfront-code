import { tool } from "veryfront/ai";
import { z } from "zod";
import { createTwitterClient } from "../../lib/twitter-client.ts";

export default tool({
  id: "get-timeline",
  description: "Get the authenticated user's home timeline (tweets from followed accounts)",
  inputSchema: z.object({
    maxResults: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum number of tweets to return (default: 10)"),
  }),
  execute: async ({ maxResults }, context) => {
    const userId = (context?.userId as string | undefined) || "current-user";

    try {
      const twitter = createTwitterClient(userId);
      const tweets = await twitter.getTimeline({
        maxResults: maxResults || 10,
      });

      if (!tweets || tweets.length === 0) {
        return {
          success: true,
          tweets: [],
          count: 0,
          message: "No tweets found in your timeline.",
        };
      }

      return {
        success: true,
        tweets: tweets.map((tweet) => ({
          id: tweet.id,
          text: tweet.text,
          author_id: tweet.author_id,
          created_at: tweet.created_at,
          metrics: tweet.public_metrics,
          hashtags: tweet.entities?.hashtags?.map((h) => h.tag),
          mentions: tweet.entities?.mentions?.map((m) => m.username),
        })),
        count: tweets.length,
        message: `Retrieved ${tweets.length} tweets from your timeline.`,
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
