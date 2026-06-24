import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { getThread, summarizeContact, summarizeContacts } from "../../lib/outlook-client.ts";

export default tool({
  id: "get-thread",
  description:
    "Get all Outlook messages in a conversation thread by thread_id. thread_id is the conversationId returned by list-threads.",
  inputSchema: defineSchema((v) => v.object({
    thread_id: v
      .string()
      .min(1)
      .describe("Outlook conversationId returned by list-threads"),
    limit: v
      .number()
      .min(1)
      .max(50)
      .default(25)
      .describe("Maximum messages to return for the thread"),
  }))(),
  async execute({ thread_id, limit }) {
    const messages = await getThread(thread_id, limit);
    const firstMessage = messages[0];

    return {
      thread: {
        thread_id,
        subject: firstMessage?.subject ?? "",
        messages: messages.map((message) => ({
          id: message.id,
          subject: message.subject,
          from: summarizeContact(message.from),
          to: summarizeContacts(message.toRecipients),
          cc: summarizeContacts(message.ccRecipients),
          body: message.body,
          bodyPreview: message.bodyPreview,
          receivedAt: message.receivedDateTime,
          sentAt: message.sentDateTime,
          isRead: message.isRead,
          hasAttachments: message.hasAttachments,
          importance: message.importance,
          webLink: message.webLink,
        })),
      },
    };
  },
});
