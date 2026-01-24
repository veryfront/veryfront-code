import { z } from "zod";
import { getZendeskClient } from "../../lib/zendesk-client.ts";
import { isZendeskConnected } from "../../lib/token-store.ts";

export default defineTool({
  id: "zendesk-list-tickets",
  description: "List tickets from Zendesk with optional filters for status, priority, or assignee",
  inputSchema: z.object({
    limit: z.number().optional().describe("Maximum number of tickets to return (default: 20)"),
    status: z
      .enum(["new", "open", "pending", "hold", "solved", "closed"])
      .optional()
      .describe("Filter by ticket status"),
    priority: z
      .enum(["urgent", "high", "normal", "low"])
      .optional()
      .describe("Filter by priority level"),
    assigneeId: z.number().optional().describe("Filter by assignee user ID"),
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
      const tickets = await client.listTickets({
        limit: input.limit,
        status: input.status,
        priority: input.priority,
        assigneeId: input.assigneeId,
      });

      return {
        count: tickets.length,
        tickets: tickets.map(
          ({
            id,
            subject,
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
        error: error instanceof Error ? error.message : "Failed to list tickets",
      };
    }
  },
});
