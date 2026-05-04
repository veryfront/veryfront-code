import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "watch-mailbox",
  description: "Start Gmail push notifications for mailbox changes using a Cloud Pub/Sub topic.",
  inputSchema: z.object({
    topicName: z
      .string()
      .min(1)
      .describe("Cloud Pub/Sub topic name, for example projects/<PROJECT_ID>/topics/<TOPIC_ID>"),
    labelIds: z.array(z.string().min(1)).optional().describe("Labels used to filter notifications"),
    labelFilterBehavior: z
      .enum(["include", "exclude"])
      .optional()
      .describe("Whether labelIds are included or excluded"),
  }),
  execute: async (input, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      return await gmail.watchMailbox(input);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not connected")) {
        return {
          error: "Gmail not connected. Please connect your Gmail account.",
          connectUrl: "/api/auth/gmail",
        };
      }
      throw error;
    }
  },
});
