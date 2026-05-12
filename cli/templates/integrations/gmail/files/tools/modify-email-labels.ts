import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

const getModifyLabelsInput = defineSchema((v) => v
  .object({
    messageId: v.string().min(1).describe("Gmail message ID"),
    addLabelIds: v.array(v.string().min(1)).optional().describe("Label IDs to add"),
    removeLabelIds: v.array(v.string().min(1)).optional().describe("Label IDs to remove"),
  })
  .refine((value) => value.addLabelIds?.length || value.removeLabelIds?.length, {
    message: "At least one label must be added or removed",
  }));

export default tool({
  id: "modify-email-labels",
  description: "Modify labels on a Gmail message.",
  inputSchema: getModifyLabelsInput(),
  execute: async ({ messageId, addLabelIds, removeLabelIds }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const message = await gmail.modifyMessageLabels(messageId, { addLabelIds, removeLabelIds });

      return {
        success: true,
        message,
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
