import { tool } from "veryfront/tool";
import { z } from "zod";
import { listEmails } from "../../lib/outlook-client.ts";

export default tool({
  id: "list-emails",
  description:
    "List recent emails from inbox or a specific folder. Returns email metadata including subject, sender, date, and preview.",
  inputSchema: z.object({
    folderId: z.string().optional().describe("Folder ID to list emails from (default: inbox)"),
    limit: z.number().min(1).max(50).default(10).describe("Maximum number of emails to return"),
    unreadOnly: z.boolean().default(false).describe("Only return unread emails"),
    orderBy: z.enum(["receivedDateTime desc", "receivedDateTime asc", "subject"]).default(
      "receivedDateTime desc",
    ).describe("Sort order for emails"),
  }),
  async execute({ folderId, limit, unreadOnly, orderBy }) {
    const filter = unreadOnly ? "isRead eq false" : undefined;

    const messages = await listEmails({
      folderId,
      top: limit,
      filter,
      orderBy,
    });

    return messages.map((msg) => ({
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
    }));
  },
});
