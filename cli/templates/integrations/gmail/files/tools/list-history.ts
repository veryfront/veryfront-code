import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { resolveUserId } from "../lib/context.ts";

const HISTORY_TYPES = [
  "messageAdded",
  "messageDeleted",
  "labelAdded",
  "labelRemoved",
] as const;

export default tool({
  id: "list-history",
  description: "List Gmail mailbox history changes after a start history ID.",
  inputSchema: defineSchema((v) =>
    v.object({
      startHistoryId: v.string().min(1).describe("History ID to start after"),
      maxResults: v.number().min(1).max(500).optional().describe(
        "Maximum history records",
      ),
      pageToken: v.string().optional().describe("Page token for pagination"),
      labelId: v.string().optional().describe(
        "Only return history for this label",
      ),
      historyTypes: v
        .array(
          v.enum([
            "messageAdded",
            "messageDeleted",
            "labelAdded",
            "labelRemoved",
          ]),
        )
        .optional()
        .describe("History event types to return"),
    })
  )(),
  execute: async (input, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      return await gmail.listHistory({
        ...input,
        historyTypes: input.historyTypes?.map((historyType) =>
          requireAllowedValue(historyType, HISTORY_TYPES, "historyTypes")
        ),
      });
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
