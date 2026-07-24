import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

export default tool({
  id: "gmail-delete-label",
  description: "Delete a Gmail user label.",
  inputSchema: defineSchema((v) =>
    v.object({
      labelId: v.string().min(1).describe("Gmail label ID"),
    })
  )(),
  execute: async ({ labelId }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      await gmail.deleteLabel(labelId);

      return {
        success: true,
        labelId,
        message: "Label deleted.",
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
