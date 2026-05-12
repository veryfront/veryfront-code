import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "batch-delete-emails",
  description: "Permanently delete multiple Gmail messages.",
  inputSchema: defineSchema((v) => v.object({
    messageIds: v.array(v.string().min(1)).min(1).describe("Gmail message IDs"),
  }))(),
  execute: async ({ messageIds }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      await gmail.batchDeleteMessages(messageIds);

      return {
        success: true,
        count: messageIds.length,
        message: `Permanently deleted ${messageIds.length} email(s).`,
      };
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
