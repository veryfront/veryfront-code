import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "delete-thread",
  description: "Permanently delete a Gmail thread.",
  inputSchema: z.object({
    threadId: z.string().min(1).describe("Gmail thread ID"),
  }),
  execute: async ({ threadId }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      await gmail.deleteThread(threadId);

      return {
        success: true,
        threadId,
        message: "Thread permanently deleted.",
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
