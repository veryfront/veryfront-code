import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient, parseEmailHeaders } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "get-email",
  description: "Get a Gmail message by ID, including headers, labels, snippet, and payload data.",
  inputSchema: z.object({
    messageId: z.string().min(1).describe("Gmail message ID"),
    format: z.enum(["full", "metadata", "minimal", "raw"]).default("full").describe(
      "Message format",
    ),
  }),
  execute: async ({ messageId, format }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const message = await gmail.getMessage(messageId, format);
      const headers = parseEmailHeaders(message.payload?.headers ?? []);

      return {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds ?? [],
        snippet: message.snippet,
        headers,
        payload: message.payload,
        raw: message.raw,
        internalDate: message.internalDate,
        historyId: message.historyId,
        sizeEstimate: message.sizeEstimate,
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
