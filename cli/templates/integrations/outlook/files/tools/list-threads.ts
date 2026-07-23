import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createOutlookClient } from "../lib/outlook-client.ts";
import { requireUserIdFromContext } from "../lib/user-id.ts";

export default tool({
  id: "list-threads",
  description:
    "List recent Outlook conversation threads for request-desk triage. Returns representative messages with thread_id values that can be passed to get-thread.",
  inputSchema: defineSchema((v) =>
    v.object({
      folderId: v
        .string()
        .default("inbox")
        .describe("Folder ID or well-known folder name to inspect"),
      limit: v
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe(
          "Maximum recent messages to inspect as thread representatives",
        ),
      unreadOnly: v.boolean().default(false).describe(
        "Only return unread messages",
      ),
      orderBy: v
        .enum(["receivedDateTime desc", "receivedDateTime asc", "subject"])
        .default("receivedDateTime desc")
        .describe("Sort order for representative messages"),
    })
  )(),
  async execute({ folderId, limit, unreadOnly, orderBy }, context) {
    const userId = requireUserIdFromContext(context);
    const client = createOutlookClient(userId);
    const messages = await client.listThreads({
      folderId,
      top: limit,
      filter: unreadOnly ? "isRead eq false" : undefined,
      orderBy,
    });

    return {
      threads: messages.map((message) => ({
        thread_id: message.conversationId,
        messageId: message.id,
        subject: message.subject,
        from: client.summarizeContact(message.from),
        preview: message.bodyPreview,
        receivedAt: message.receivedDateTime,
        isRead: message.isRead,
        hasAttachments: message.hasAttachments,
        importance: message.importance,
        webLink: message.webLink,
      })),
    };
  },
});
