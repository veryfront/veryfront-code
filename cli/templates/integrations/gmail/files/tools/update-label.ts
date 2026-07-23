import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createGmailClient } from "../lib/gmail-client.ts";
import { optionalAllowedValue } from "../lib/allowed-value.ts";
import { resolveUserId } from "../lib/context.ts";

const MESSAGE_LIST_VISIBILITIES = ["show", "hide"] as const;
const LABEL_LIST_VISIBILITIES = [
  "labelShow",
  "labelShowIfUnread",
  "labelHide",
] as const;

export default tool({
  id: "update-label",
  description: "Update a Gmail user label.",
  inputSchema: defineSchema((v) =>
    v.object({
      labelId: v.string().min(1).describe("Gmail label ID"),
      name: v.string().min(1).describe("Label display name"),
      messageListVisibility: v.enum(["show", "hide"]).optional().describe(
        "Message list visibility",
      ),
      labelListVisibility: v
        .enum(["labelShow", "labelShowIfUnread", "labelHide"])
        .optional()
        .describe("Label list visibility"),
      textColor: v.string().optional().describe("Label text color hex value"),
      backgroundColor: v.string().optional().describe(
        "Label background color hex value",
      ),
    })
  )(),
  execute: async (
    {
      labelId,
      name,
      messageListVisibility,
      labelListVisibility,
      textColor,
      backgroundColor,
    },
    context,
  ) => {
    const userId = resolveUserId(context);

    try {
      const gmail = createGmailClient(userId);
      const label = await gmail.updateLabel(labelId, {
        name,
        messageListVisibility: optionalAllowedValue(
          messageListVisibility,
          MESSAGE_LIST_VISIBILITIES,
          "messageListVisibility",
        ),
        labelListVisibility: optionalAllowedValue(
          labelListVisibility,
          LABEL_LIST_VISIBILITIES,
          "labelListVisibility",
        ),
        ...(textColor && backgroundColor
          ? { color: { textColor, backgroundColor } }
          : {}),
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
