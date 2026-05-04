import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "list-history",
  description: "List Gmail mailbox history changes after a start history ID.",
  inputSchema: z.object({
    startHistoryId: z.string().min(1).describe("History ID to start after"),
    maxResults: z.number().min(1).max(500).optional().describe("Maximum history records"),
    pageToken: z.string().optional().describe("Page token for pagination"),
    labelId: z.string().optional().describe("Only return history for this label"),
    historyTypes: z
      .array(z.enum(["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"]))
      .optional()
      .describe("History event types to return"),
  }),
  execute: async (input, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      return await gmail.listHistory(input);
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
