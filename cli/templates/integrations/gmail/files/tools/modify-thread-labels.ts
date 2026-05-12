import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

const getModifyThreadLabelsInput = defineSchema((v) => v
  .object({
    threadId: v.string().min(1).describe("Gmail thread ID"),
    addLabelIds: v.array(v.string().min(1)).optional().describe("Label IDs to add"),
    removeLabelIds: v.array(v.string().min(1)).optional().describe("Label IDs to remove"),
  })
  .refine((value) => value.addLabelIds?.length || value.removeLabelIds?.length, {
    message: "At least one label must be added or removed",
  }));

export default tool({
  id: "modify-thread-labels",
  description: "Modify labels on a Gmail thread.",
  inputSchema: getModifyThreadLabelsInput(),
  execute: async ({ threadId, addLabelIds, removeLabelIds }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const thread = await gmail.modifyThreadLabels(threadId, { addLabelIds, removeLabelIds });

      return {
        success: true,
        thread,
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
