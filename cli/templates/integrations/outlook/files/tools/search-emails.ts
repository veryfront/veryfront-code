import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createOutlookClient } from "../lib/outlook-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "search-emails",
  description:
    "Search emails by query string. Searches across subject, body, sender, and recipients. Supports advanced search syntax.",
  inputSchema: defineSchema((v) =>
    v.object({
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
    })
  )(),
  async execute({ query, limit }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createOutlookClient(userId);
    const messages = await client.searchEmails({ query, top: limit });

    return {
      totalResults: messages.length,
      emails: messages.map((msg) => ({
        id: msg.id,
        subject: msg.subject,
        from: client.summarizeContact(msg.from),
        to: client.summarizeContacts(msg.toRecipients),
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
