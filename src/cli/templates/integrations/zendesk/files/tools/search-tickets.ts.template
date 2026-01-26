import { z } from "zod";
import { getZendeskClient } from "../../lib/zendesk-client.ts";
import { isZendeskConnected } from "../../lib/token-store.ts";

export default defineTool({
  id: "zendesk-search-tickets",
  description:
    "Search tickets using Zendesk query syntax. Examples: 'status:open priority:urgent', 'subject:bug', 'tags:billing'",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "Search query using Zendesk syntax (e.g., 'status:open priority:urgent', 'subject:refund', 'tags:billing')",
      ),
    limit: z.number().optional().describe("Maximum number of results to return (default: 20)"),
  }),
  async execute(input) {
    if (!(await isZendeskConnected())) {
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
        tickets: tickets.map(
          ({
            id,
            subject,
            description,
            status,
            priority,
            type,
            requester_id,
            assignee_id,
            tags,
            created_at,
            updated_at,
          }) => ({
            id,
            subject,
            description,
            status,
            priority,
            type,
            requester_id,
            assignee_id,
            tags,
            created_at,
            updated_at,
          }),
        ),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to search tickets",
      };
    }
  },
});
