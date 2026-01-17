import { tool } from "veryfront/tool";
import { z } from "zod";
import { getEmail } from "../../lib/outlook-client.ts";

export default tool({
  id: "get-email",
  description:
    "Get detailed information about a specific email, including full body content, recipients, and metadata.",
  inputSchema: z.object({
    messageId: z.string().describe("The ID of the email message to retrieve"),
    includeBody: z.boolean().default(true).describe("Include full email body content"),
  }),
  async execute({ messageId, includeBody }) {
    const message = await getEmail(messageId);

    return {
      id: message.id,
      subject: message.subject,
      from: {
        name: message.from.emailAddress.name,
        email: message.from.emailAddress.address,
      },
      to: message.toRecipients.map((r) => ({
        name: r.emailAddress.name,
        email: r.emailAddress.address,
      })),
      cc: message.ccRecipients?.map((r) => ({
        name: r.emailAddress.name,
        email: r.emailAddress.address,
      })),
      body: includeBody
        ? {
          contentType: message.body.contentType,
          content: message.body.content,
        }
        : undefined,
      bodyPreview: message.bodyPreview,
      receivedAt: message.receivedDateTime,
      sentAt: message.sentDateTime,
      isRead: message.isRead,
      hasAttachments: message.hasAttachments,
      importance: message.importance,
      conversationId: message.conversationId,
      webLink: message.webLink,
    };
  },
});
