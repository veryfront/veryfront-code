import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "mark-email-read",
  description: "Mark a Gmail message as read by removing the UNREAD label.",
  inputSchema: defineSchema((v) =>
    v.object({
      messageId: v.string().min(1).describe("Gmail message ID"),
    })
  )(),
  execute: async ({ messageId }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      await gmail.markAsRead(messageId);

      return {
        success: true,
        messageId,
        message: "Email marked as read.",
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
