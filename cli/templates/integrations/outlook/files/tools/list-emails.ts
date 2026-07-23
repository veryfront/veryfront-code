import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createOutlookClient } from "../lib/outlook-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "list-emails",
  description:
    "List recent emails from inbox or a specific folder. Returns email metadata including subject, sender, date, and preview.",
  inputSchema: defineSchema((v) =>
    v.object({
      folderId: v
        .string()
        .optional()
        .describe("Folder ID to list emails from (default: inbox)"),
      limit: v
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum number of emails to return"),
      unreadOnly: v.boolean().default(false).describe(
        "Only return unread emails",
      ),
      orderBy: v
        .enum(["receivedDateTime desc", "receivedDateTime asc", "subject"])
        .default("receivedDateTime desc")
        .describe("Sort order for emails"),
    })
  )(),
  async execute({ folderId, limit, unreadOnly, orderBy }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createOutlookClient(userId);
    const messages = await client.listEmails({
      folderId,
      top: limit,
      filter: unreadOnly ? "isRead eq false" : undefined,
      orderBy,
    });

    return messages.map((msg) => ({
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
    }));
  },
});
