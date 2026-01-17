import { tool } from "veryfront/tool";
import { z } from "zod";
import { searchEmails } from "../../lib/outlook-client.ts";

export default tool({
  id: "search-emails",
  description:
    "Search emails by query string. Searches across subject, body, sender, and recipients. Supports advanced search syntax.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Search query (searches subject, body, from, to fields)"),
    limit: z.number().min(1).max(50).default(10).describe("Maximum number of results to return"),
  }),
  async execute({ query, limit }) {
    const messages = await searchEmails({
      query,
      top: limit,
    });

    return {
      totalResults: messages.length,
      emails: messages.map((msg) => ({
        id: msg.id,
        subject: msg.subject,
        from: {
          name: msg.from.emailAddress.name,
          email: msg.from.emailAddress.address,
        },
        to: msg.toRecipients.map((r) => ({
          name: r.emailAddress.name,
          email: r.emailAddress.address,
        })),
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
