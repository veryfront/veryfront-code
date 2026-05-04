import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "get-attachment",
  description: "Get a Gmail message attachment by message ID and attachment ID.",
  inputSchema: z.object({
    messageId: z.string().min(1).describe("Gmail message ID"),
    attachmentId: z.string().min(1).describe("Gmail attachment ID"),
  }),
  execute: async ({ messageId, attachmentId }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      return await gmail.getAttachment(messageId, attachmentId);
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
