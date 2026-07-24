import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "gmail-archive-email",
  description: "Archive a Gmail message by removing the INBOX label.",
  inputSchema: defineSchema((v) =>
    v.object({
      messageId: v.string().min(1).describe("Gmail message ID"),
    })
  )(),
  execute: async ({ messageId }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      await gmail.archiveEmail(messageId);

      return {
        success: true,
        messageId,
        message: "Email archived.",
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
