import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

const ModifyThreadLabelsInput = z
  .object({
    threadId: z.string().min(1).describe("Gmail thread ID"),
    addLabelIds: z.array(z.string().min(1)).optional().describe("Label IDs to add"),
    removeLabelIds: z.array(z.string().min(1)).optional().describe("Label IDs to remove"),
  })
  .refine((value) => value.addLabelIds?.length || value.removeLabelIds?.length, {
    message: "At least one label must be added or removed",
  });

export default tool({
  id: "modify-thread-labels",
  description: "Modify labels on a Gmail thread.",
  inputSchema: ModifyThreadLabelsInput,
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
