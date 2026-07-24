import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "gmail-delete-draft",
  description: "Permanently delete a Gmail draft.",
  inputSchema: defineSchema((v) =>
    v.object({
      draftId: v.string().min(1).describe("Gmail draft ID"),
    })
  )(),
  execute: async ({ draftId }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      await gmail.deleteDraft(draftId);

      return {
        success: true,
        draftId,
        message: "Draft deleted.",
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
