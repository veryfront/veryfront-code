
import { z } from "zod";
import { defineTool } from "veryfront/ai";
import { getZendeskClient } from "../../lib/zendesk-client.ts";
import { isZendeskConnected } from "../../lib/token-store.ts";

export default defineTool({
  id: "zendesk-get-ticket",
  description: "Get detailed information about a specific Zendesk ticket by ID",
  inputSchema: z.object({
    ticketId: z.number().describe("The ticket ID to retrieve"),
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
      const ticket = await client.getTicket(input.ticketId);

      return {
        ticket: {
          id: ticket.id,
          url: ticket.url,
          subject: ticket.subject,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          type: ticket.type,
          requester_id: ticket.requester_id,
          submitter_id: ticket.submitter_id,
          assignee_id: ticket.assignee_id,
          tags: ticket.tags,
          created_at: ticket.created_at,
          updated_at: ticket.updated_at,
          due_at: ticket.due_at,
        },
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to get ticket",
      };
    }
  },
});
