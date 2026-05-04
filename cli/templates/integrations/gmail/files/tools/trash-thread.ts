import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "trash-thread",
  description: "Move a Gmail thread to trash.",
  inputSchema: z.object({
    threadId: z.string().min(1).describe("Gmail thread ID"),
  }),
  execute: async ({ threadId }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const thread = await gmail.trashThread(threadId);

      return {
        success: true,
        thread,
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
