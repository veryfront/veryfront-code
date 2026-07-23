import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "untrash-thread",
  description: "Remove a Gmail thread from trash.",
  inputSchema: defineSchema((v) =>
    v.object({
      threadId: v.string().min(1).describe("Gmail thread ID"),
    })
  )(),
  execute: async ({ threadId }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const thread = await gmail.untrashThread(threadId);

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
