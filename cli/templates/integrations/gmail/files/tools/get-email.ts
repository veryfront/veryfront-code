import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient, parseEmailHeaders } from "../lib/gmail-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { resolveUserId } from "../lib/context.ts";

const MESSAGE_FORMATS = ["full", "metadata", "minimal", "raw"] as const;

export default tool({
  id: "gmail-get-email",
  description:
    "Get a Gmail message by ID, including headers, labels, snippet, and payload data.",
  inputSchema: defineSchema((v) =>
    v.object({
      messageId: v.string().min(1).describe("Gmail message ID"),
      format: v.enum(["full", "metadata", "minimal", "raw"]).default("full")
        .describe(
          "Message format",
        ),
    })
  )(),
  execute: async ({ messageId, format }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const message = await gmail.getMessage(
        messageId,
        requireAllowedValue(format, MESSAGE_FORMATS, "format"),
      );
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
