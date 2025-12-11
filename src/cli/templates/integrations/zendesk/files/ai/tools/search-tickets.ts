
import { z } from "zod";
import { defineTool } from "veryfront/ai";
import { getZendeskClient } from "../../lib/zendesk-client.ts";
import { isZendeskConnected } from "../../lib/token-store.ts";

export default defineTool({
  id: "zendesk-search-tickets",
  description:
    "Search tickets using Zendesk query syntax. Examples: 'status:open priority:urgent', 'subject:bug', 'tags:billing'",
  inputSchema: z.object({
    query: z.string().describe(
      "Search query using Zendesk syntax (e.g., 'status:open priority:urgent', 'subject:refund', 'tags:billing')",
    ),
    limit: z.number().optional().describe("Maximum number of results to return (default: 20)"),
  }),
  async execute(input) {
    const connected = await isZendeskConnected();
    if (!connected) {
      return {
        error: "Zendesk not connected",
        action: "Please connect Zendesk via /api/auth/zendesk",
      };
    }

    try {
      const client = getZendeskClient();
      const tickets = await client.searchTickets(input.query, input.limit);

      return {
        count: tickets.length,
        query: input.query,
        tickets: tickets.map((ticket) => ({
          id: ticket.id,
          subject: ticket.subject,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          type: ticket.type,
          requester_id: ticket.requester_id,
          assignee_id: ticket.assignee_id,
          tags: ticket.tags,
          created_at: ticket.created_at,
          updated_at: ticket.updated_at,
        })),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to search tickets",
      };
    }
  },
});
