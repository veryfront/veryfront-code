import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createTeamsClient } from "../lib/teams-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "teams-get-messages",
  description:
    "Get messages from a specific Microsoft Teams chat. Returns message content, sender information, and timestamps. Use list-chats first to get chat IDs.",
  inputSchema: defineSchema((v) =>
    v.object({
      chatId: v.string().describe("The ID of the chat to get messages from"),
      limit: v
        .number()
        .min(1)
        .max(50)
        .default(20)
        .describe("Maximum number of messages to return (1-50)"),
      includeHtml: v
        .boolean()
        .default(false)
        .describe("Include HTML formatted content in addition to plain text"),
    })
  )(),
  async execute({ chatId, limit, includeHtml }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createTeamsClient(userId);
    const messages = await client.getChatMessages(chatId, {
      limit,
      orderBy: "createdDateTime desc",
    });

    return messages
      .filter((msg) => msg.messageType === "message")
      .map((msg) => {
        const attachments = msg.attachments ?? [];
        const mentions = msg.mentions ?? [];
        const reactions = msg.reactions ?? [];

        return {
          id: msg.id,
          content: client.getPlainTextContent(msg),
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
          hasAttachments: attachments.length > 0,
          attachmentCount: attachments.length,
          attachments: attachments.map((att) => ({
            id: att.id,
            name: att.name,
            contentType: att.contentType,
            contentUrl: att.contentUrl,
          })),
          mentions: mentions.map((mention) => ({
            text: mention.mentionText,
            userId: mention.mentioned.user.id,
            displayName: mention.mentioned.user.displayName,
          })),
          reactionCount: reactions.length,
        };
      });
  },
});
