import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "stop-mailbox-watch",
  description: "Stop Gmail push notifications for the connected mailbox.",
  inputSchema: defineSchema((v) => v.object({}))(),
  execute: async (_input, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      await gmail.stopMailboxWatch();

      return {
        success: true,
        message: "Mailbox watch stopped.",
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
