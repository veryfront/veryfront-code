import { tool } from "veryfront/tool";
import { z } from "zod";
import { createSlackClient } from "../../lib/slack-client.ts";

export default tool({
  id: "send-message",
  description: "Send a message to a Slack channel",
  inputSchema: z.object({
    channel: z
      .string()
      .describe("Channel ID or name (e.g., 'C1234567890' or '#general')"),
    text: z
      .string()
      .min(1)
      .describe("Message text to send"),
    threadTs: z
      .string()
      .optional()
      .describe("Thread timestamp to reply to (for threaded messages)"),
  }),
  execute: async ({ channel, text, threadTs }, context) => {
    // Default to "current-user" for development; in production, always pass userId from session
    const userId = (context?.userId as string | undefined) || "current-user";

    try {
      const slack = createSlackClient(userId);
      const result = await slack.sendMessage(channel, text, { threadTs });

      return {
        success: true,
        messageTs: result.ts,
        channel: result.channel,
        message: threadTs ? `Reply sent to thread in ${channel}.` : `Message sent to ${channel}.`,
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
