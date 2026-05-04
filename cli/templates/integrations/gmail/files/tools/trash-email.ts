import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "trash-email",
  description: "Move a Gmail message to trash.",
  inputSchema: z.object({
    messageId: z.string().min(1).describe("Gmail message ID"),
  }),
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
