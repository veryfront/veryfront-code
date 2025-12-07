import { tool } from "veryfront/ai";
import { z } from "zod";
import { listConversations } from "../../lib/intercom-client.ts";

export default tool({
  id: "list-conversations",
  description: "List conversations from Intercom. Can filter by open/closed status.",
  inputSchema: z.object({
    page: z.number().min(1).default(1).describe("Page number for pagination"),
    perPage: z.number().min(1).max(150).default(50).describe("Number of conversations per page (max 150)"),
    open: z.boolean().optional().describe("Filter by open (true) or closed (false) conversations"),
    limit: z.number().min(1).max(50).default(20).describe("Maximum number of conversations to return"),
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
        createdAt: new Date(conv.created_at * 1000).toISOString(),
        updatedAt: new Date(conv.updated_at * 1000).toISOString(),
        waitingSince: conv.waiting_since
          ? new Date(conv.waiting_since * 1000).toISOString()
          : null,
        snoozedUntil: conv.snoozed_until
          ? new Date(conv.snoozed_until * 1000).toISOString()
          : null,
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
