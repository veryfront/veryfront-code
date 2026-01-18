import { tool } from "veryfront/tool";
import { z } from "zod";
import { createSlackClient } from "../../lib/slack-client.ts";

export default tool({
  id: "get-messages",
  description: "Get recent messages from a Slack channel",
  inputSchema: z.object({
    channel: z
      .string()
      .describe("Channel ID (e.g., 'C1234567890')"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of messages to return"),
  }),
  execute: async ({ channel, limit }, context) => {
    // Default to "current-user" for development; in production, always pass userId from session
    const userId = (context?.userId as string | undefined) || "current-user";

    try {
      const slack = createSlackClient(userId);
      const messages = await slack.getMessages(channel, { limit });

      return {
        messages: messages.map((
          msg: {
            text?: string;
            user?: string;
            ts: string;
            thread_ts?: string;
            reply_count?: number;
            reactions?: Array<{ name: string; count: number }>;
          },
        ) => ({
          text: msg.text || "",
          user: msg.user || "unknown",
          timestamp: msg.ts,
          threadTs: msg.thread_ts,
          replyCount: msg.reply_count || 0,
          reactions: msg.reactions?.map((r: { name: string; count: number }) =>
            `${r.name} (${r.count})`
          ) || [],
        })),
        count: messages.length,
        channel,
        message: `Retrieved ${messages.length} message(s) from channel.`,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "Slack not connected. Please connect your Slack account.",
          connectUrl: "/api/auth/slack",
        };
      }
      throw error;
    }
  },
});
