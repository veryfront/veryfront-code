import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { resolveUserId } from "../lib/context.ts";

const MESSAGE_FORMATS = ["full", "metadata", "minimal", "raw"] as const;

export default tool({
  id: "get-draft",
  description: "Get a Gmail draft by ID.",
  inputSchema: defineSchema((v) =>
    v.object({
      draftId: v.string().min(1).describe("Gmail draft ID"),
      format: v.enum(["full", "metadata", "minimal", "raw"]).default("full")
        .describe(
          "Draft message format",
        ),
    })
  )(),
  execute: async ({ draftId, format }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      return await gmail.getDraft(
        draftId,
        requireAllowedValue(format, MESSAGE_FORMATS, "format"),
      );
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
