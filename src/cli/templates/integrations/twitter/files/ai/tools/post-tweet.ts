import { tool } from "veryfront/tool";
import { z } from "zod";
import { createTwitterClient } from "../../lib/twitter-client.ts";

export default tool({
  id: "post-tweet",
  description: "Post a new tweet to Twitter/X. Maximum length is 280 characters.",
  inputSchema: z.object({
    text: z
      .string()
      .min(1)
      .max(280)
      .describe("Tweet text content (max 280 characters)"),
  }),
  execute: async ({ text }, context) => {
    // Default to "current-user" for development; in production, always pass userId from session
    const userId = (context?.userId as string | undefined) || "current-user";

    // Validate tweet length
    if (text.length > 280) {
      return {
        error: "Tweet text exceeds 280 character limit",
        length: text.length,
        maxLength: 280,
      };
    }

    try {
      const twitter = createTwitterClient(userId);
      const result = await twitter.postTweet(text);

      return {
        success: true,
        tweetId: result.id,
        text: result.text,
        message: "Tweet posted successfully!",
        url: `https://twitter.com/i/web/status/${result.id}`,
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
