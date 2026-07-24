import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createOutlookClient } from "../lib/outlook-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "outlook-get-email",
  description:
    "Get detailed information about a specific email, including full body content, recipients, and metadata.",
  inputSchema: defineSchema((v) =>
    v.object({
      messageId: v.string().describe("The ID of the email message to retrieve"),
      includeBody: v
        .boolean()
        .default(true)
        .describe("Include full email body content"),
    })
  )(),
  async execute({ messageId, includeBody }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createOutlookClient(userId);
    const message = await client.getEmail(messageId);

    const body = includeBody
      ? {
        contentType: message.body.contentType,
        content: message.body.content,
      }
      : undefined;

    return {
      id: message.id,
      subject: message.subject,
      from: client.summarizeContact(message.from),
      to: client.summarizeContacts(message.toRecipients),
      cc: client.summarizeContacts(message.ccRecipients),
      body,
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
