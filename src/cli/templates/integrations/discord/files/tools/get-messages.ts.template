import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatUsername, getMessages } from "../../lib/discord-client.ts";

export default tool({
  id: "get-messages",
  description:
    "Get recent messages from a Discord channel. Returns message content, authors, timestamps, and attachments.",
  inputSchema: z.object({
    channelId: z.string().describe("The ID of the Discord channel to get messages from"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum number of messages to retrieve (1-100)"),
    before: z.string().optional().describe("Get messages before this message ID"),
    after: z.string().optional().describe("Get messages after this message ID"),
  }),
  async execute({ channelId, limit, before, after }) {
    const messages = await getMessages(channelId, { limit, before, after });

    return messages.map((message) => ({
      id: message.id,
      content: message.content,
      author: {
        id: message.author.id,
        username: formatUsername(message.author),
        globalName: message.author.global_name,
        bot: message.author.bot,
      },
      timestamp: message.timestamp,
      editedTimestamp: message.edited_timestamp,
      pinned: message.pinned,
      mentions: message.mentions.map((user) => ({
        id: user.id,
        username: formatUsername(user),
      })),
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        url: attachment.url,
        size: attachment.size,
        contentType: attachment.content_type,
      })),
      hasEmbeds: message.embeds.length > 0,
      reactions: message.reactions?.map((reaction) => ({
        emoji: reaction.emoji.name,
        count: reaction.count,
        meReacted: reaction.me,
      })),
    }));
  },
});
