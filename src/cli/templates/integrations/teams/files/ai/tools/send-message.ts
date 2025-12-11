import { tool } from "veryfront/ai";
import { z } from "zod";
import { sendChannelMessage, sendChatMessage } from "../../lib/teams-client.ts";

export default tool({
  id: "send-message",
  description:
    "Send a message to a Microsoft Teams chat or channel. For chats, use the chatId. For channels, use both teamId and channelId.",
  inputSchema: z.object({
    chatId: z.string().optional().describe(
      "The ID of the chat to send the message to (use this for direct/group chats)",
    ),
    teamId: z.string().optional().describe(
      "The ID of the team (use with channelId for channel messages)",
    ),
    channelId: z.string().optional().describe(
      "The ID of the channel (use with teamId for channel messages)",
    ),
    content: z.string().min(1).describe("The message content to send"),
    contentType: z.enum(["text", "html"]).default("text").describe("Content format: text or html"),
    subject: z.string().optional().describe("Subject line (only for channel messages)"),
  }).refine(
    (data) =>
      (data.chatId && !data.teamId && !data.channelId) ||
      (!data.chatId && data.teamId && data.channelId),
    {
      message: "Either provide chatId OR both teamId and channelId",
    },
  ),
  async execute({ chatId, teamId, channelId, content, contentType, subject }) {
    if (chatId) {
      const message = await sendChatMessage(chatId, content, contentType);
      return {
        success: true,
        messageId: message.id,
        type: "chat",
        chatId,
        createdAt: message.createdDateTime,
        content: message.body.content,
      };
    }

    if (teamId && channelId) {
      const message = await sendChannelMessage(teamId, channelId, content, contentType, subject);
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
    }

    throw new Error("Invalid parameters: provide either chatId or both teamId and channelId");
  },
});
