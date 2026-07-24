import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createTeamsClient } from "../lib/teams-client.ts";
import { requireAllowedValue } from "../lib/allowed-value.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "teams-send-message",
  description:
    "Send a message to a Microsoft Teams chat or channel. For chats, use the chatId. For channels, use both teamId and channelId.",
  inputSchema: defineSchema((v) =>
    v
      .object({
        chatId: v
          .string()
          .optional()
          .describe(
            "The ID of the chat to send the message to (use this for direct/group chats)",
          ),
        teamId: v
          .string()
          .optional()
          .describe(
            "The ID of the team (use with channelId for channel messages)",
          ),
        channelId: v
          .string()
          .optional()
          .describe(
            "The ID of the channel (use with teamId for channel messages)",
          ),
        content: v.string().min(1).describe("The message content to send"),
        contentType: v.enum(["text", "html"]).default("text").describe(
          "Content format: text or html",
        ),
        subject: v.string().optional().describe(
          "Subject line (only for channel messages)",
        ),
      })
      .refine(
        (data) =>
          Boolean(
            (data.chatId && !data.teamId && !data.channelId) ||
              (!data.chatId && data.teamId && data.channelId),
          ),
        { message: "Either provide chatId OR both teamId and channelId" },
      )
  )(),
  async execute(
    { chatId, teamId, channelId, content, contentType, subject },
    context,
  ) {
    const userId = requireUserIdFromContext(context);
    const client = createTeamsClient(userId);
    if (chatId) {
      const message = await client.sendChatMessage(
        chatId,
        content,
        requireAllowedValue(contentType, ["text", "html"], "content type"),
      );
      return {
        success: true,
        messageId: message.id,
        type: "chat",
        chatId,
        createdAt: message.createdDateTime,
        content: message.body.content,
      };
    }

    if (!teamId || !channelId) {
      throw new Error(
        "Invalid parameters: provide either chatId or both teamId and channelId",
      );
    }

    const message = await client.sendChannelMessage(
      teamId,
      channelId,
      content,
      requireAllowedValue(contentType, ["text", "html"], "content type"),
      subject,
    );
    return {
      success: true,
      messageId: message.id,
      type: "channel",
      teamId,
      channelId,
      subject,
      createdAt: message.createdDateTime,
      content: message.body.content,
    };
  },
});
