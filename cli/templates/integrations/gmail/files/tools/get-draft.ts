import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "get-draft",
  description: "Get a Gmail draft by ID.",
  inputSchema: z.object({
    draftId: z.string().min(1).describe("Gmail draft ID"),
    format: z.enum(["full", "metadata", "minimal", "raw"]).default("full").describe(
      "Draft message format",
    ),
  }),
  execute: async ({ draftId, format }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      return await gmail.getDraft(draftId, format);
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
