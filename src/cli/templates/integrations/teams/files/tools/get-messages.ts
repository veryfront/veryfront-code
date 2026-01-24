import { tool } from "veryfront/tool";
import { z } from "zod";
import { getChatMessages, getPlainTextContent } from "../../lib/teams-client.ts";

export default tool({
  id: "get-messages",
  description:
    "Get messages from a specific Microsoft Teams chat. Returns message content, sender information, and timestamps. Use list-chats first to get chat IDs.",
  inputSchema: z.object({
    chatId: z.string().describe("The ID of the chat to get messages from"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(20)
      .describe("Maximum number of messages to return (1-50)"),
    includeHtml: z
      .boolean()
      .default(false)
      .describe("Include HTML formatted content in addition to plain text"),
  }),
  async execute({ chatId, limit, includeHtml }) {
    const messages = await getChatMessages(chatId, {
      limit,
      orderBy: "createdDateTime desc",
    });

    return messages
      .filter((msg) => msg.messageType === "message")
      .map((msg) => ({
        id: msg.id,
        content: getPlainTextContent(msg),
        htmlContent: includeHtml ? msg.body.content : undefined,
        contentType: msg.body.contentType,
        sender: {
          id: msg.from.user?.id,
          displayName: msg.from.user?.displayName,
        },
        createdAt: msg.createdDateTime,
        lastModified: msg.lastModifiedDateTime,
        importance: msg.importance,
        subject: msg.subject,
        hasAttachments: (msg.attachments?.length ?? 0) > 0,
        attachmentCount: msg.attachments?.length ?? 0,
        attachments: msg.attachments?.map((att) => ({
          id: att.id,
          name: att.name,
          contentType: att.contentType,
          contentUrl: att.contentUrl,
        })),
        mentions: msg.mentions?.map((mention) => ({
          text: mention.mentionText,
          userId: mention.mentioned.user.id,
          displayName: mention.mentioned.user.displayName,
        })),
        reactionCount: msg.reactions?.length ?? 0,
      }));
  },
});
