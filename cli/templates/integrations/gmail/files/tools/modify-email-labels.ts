import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

const ModifyLabelsInput = z
  .object({
    messageId: z.string().min(1).describe("Gmail message ID"),
    addLabelIds: z.array(z.string().min(1)).optional().describe("Label IDs to add"),
    removeLabelIds: z.array(z.string().min(1)).optional().describe("Label IDs to remove"),
  })
  .refine((value) => value.addLabelIds?.length || value.removeLabelIds?.length, {
    message: "At least one label must be added or removed",
  });

export default tool({
  id: "modify-email-labels",
  description: "Modify labels on a Gmail message.",
  inputSchema: ModifyLabelsInput,
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
