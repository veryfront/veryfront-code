import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "trash-email",
  description: "Move a Gmail message to trash.",
  inputSchema: defineSchema((v) =>
    v.object({
      messageId: v.string().min(1).describe("Gmail message ID"),
    })
  )(),
  execute: async ({ messageId }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const message = await gmail.trashMessage(messageId);

      return {
        success: true,
        message,
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
