import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { searchEmails, summarizeContact, summarizeContacts } from "../../lib/outlook-client.ts";

export default tool({
  id: "search-emails",
  description:
    "Search emails by query string. Searches across subject, body, sender, and recipients. Supports advanced search syntax.",
  inputSchema: defineSchema((v) => v.object({
    query: v
      .string()
      .min(1)
      .describe("Search query (searches subject, body, from, to fields)"),
    limit: v
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of results to return"),
  }))(),
  async execute({ query, limit }) {
    const messages = await searchEmails({ query, top: limit });

    return {
      totalResults: messages.length,
      emails: messages.map((msg) => ({
        id: msg.id,
        subject: msg.subject,
        from: summarizeContact(msg.from),
        to: summarizeContacts(msg.toRecipients),
        preview: msg.bodyPreview,
        receivedAt: msg.receivedDateTime,
        isRead: msg.isRead,
        hasAttachments: msg.hasAttachments,
        importance: msg.importance,
        webLink: msg.webLink,
      })),
    };
  },
});
