import { tool } from "veryfront/tool";
import { z } from "zod";
import { listConversations } from "../../lib/intercom-client.ts";

function toIsoSeconds(seconds?: number | null): string | null {
  if (seconds == null) return null;
  return new Date(seconds * 1000).toISOString();
}

export default tool({
  id: "list-conversations",
  description: "List conversations from Intercom. Can filter by open/closed status.",
  inputSchema: z.object({
    page: z.number().min(1).default(1).describe("Page number for pagination"),
    perPage: z
      .number()
      .min(1)
      .max(150)
      .default(50)
      .describe("Number of conversations per page (max 150)"),
    open: z
      .boolean()
      .optional()
      .describe("Filter by open (true) or closed (false) conversations"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(20)
      .describe("Maximum number of conversations to return"),
  }),
  async execute({ page, perPage, open, limit }) {
    const { conversations, hasMore } = await listConversations({ page, perPage, open });

    return {
      conversations: conversations.slice(0, limit).map((conv) => ({
        id: conv.id,
        title: conv.title,
        state: conv.state,
        read: conv.read,
        priority: conv.priority,
        createdAt: toIsoSeconds(conv.created_at) as string,
        updatedAt: toIsoSeconds(conv.updated_at) as string,
        waitingSince: toIsoSeconds(conv.waiting_since),
        snoozedUntil: toIsoSeconds(conv.snoozed_until),
        source: {
          type: conv.source.type,
          subject: conv.source.subject,
          body: conv.source.body,
          author: {
            id: conv.source.author.id,
            name: conv.source.author.name,
            email: conv.source.author.email,
          },
        },
        contactIds: conv.contacts?.map((c) => c.id),
        teammateIds: conv.teammates?.map((t) => t.id),
      })),
      hasMore,
      page,
    };
  },
});
