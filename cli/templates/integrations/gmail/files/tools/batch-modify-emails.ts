import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

const getBatchModifyInput = defineSchema((v) =>
  v
    .object({
      messageIds: v.array(v.string().min(1)).min(1).describe(
        "Gmail message IDs",
      ),
      addLabelIds: v.array(v.string().min(1)).optional().describe(
        "Label IDs to add",
      ),
      removeLabelIds: v.array(v.string().min(1)).optional().describe(
        "Label IDs to remove",
      ),
    })
    .refine(
      (value) =>
        Boolean(value.addLabelIds?.length || value.removeLabelIds?.length),
      {
        message: "At least one label must be added or removed",
      },
    )
);

export default tool({
  id: "batch-modify-emails",
  description: "Modify labels on multiple Gmail messages.",
  inputSchema: getBatchModifyInput(),
  execute: async ({ messageIds, addLabelIds, removeLabelIds }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      await gmail.batchModifyMessages(messageIds, {
        addLabelIds,
        removeLabelIds,
      });

      return {
        success: true,
        count: messageIds.length,
        message: `Modified ${messageIds.length} email(s).`,
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
