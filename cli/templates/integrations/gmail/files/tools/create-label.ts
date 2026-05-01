import { tool } from "veryfront/tool";
import { z } from "zod";
import { createGmailClient } from "../lib/gmail-client.ts";
import { resolveUserId } from "../lib/context.ts";

const LabelInput = z.object({
  name: z.string().min(1).describe("Label display name"),
  messageListVisibility: z.enum(["show", "hide"]).optional().describe("Message list visibility"),
  labelListVisibility: z
    .enum(["labelShow", "labelShowIfUnread", "labelHide"])
    .optional()
    .describe("Label list visibility"),
  textColor: z.string().optional().describe("Label text color hex value"),
  backgroundColor: z.string().optional().describe("Label background color hex value"),
});

export default tool({
  id: "create-label",
  description: "Create a Gmail user label.",
  inputSchema: LabelInput,
  execute: async ({ textColor, backgroundColor, ...input }, context) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const label = await gmail.createLabel({
        ...input,
        ...(textColor && backgroundColor ? { color: { textColor, backgroundColor } } : {}),
      });

      return {
        success: true,
        label,
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
