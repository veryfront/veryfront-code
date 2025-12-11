
import { z } from "zod";
import { defineTool } from "veryfront/ai";
import { getZendeskClient } from "../../lib/zendesk-client.ts";
import { isZendeskConnected } from "../../lib/token-store.ts";

export default defineTool({
  id: "zendesk-create-ticket",
  description: "Create a new ticket in Zendesk",
  inputSchema: z.object({
    subject: z.string().describe("Subject/title of the ticket"),
    body: z.string().describe("Description/body content of the ticket"),
    priority: z.enum(["urgent", "high", "normal", "low"]).optional()
      .describe("Priority level of the ticket"),
    type: z.enum(["problem", "incident", "question", "task"]).optional()
      .describe("Type of ticket"),
    tags: z.array(z.string()).optional().describe("Tags to add to the ticket"),
    assigneeId: z.number().optional().describe("User ID to assign the ticket to"),
    requesterName: z.string().optional().describe("Name of the requester (if creating on behalf)"),
    requesterEmail: z.string().optional().describe(
      "Email of the requester (if creating on behalf)",
    ),
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

      const ticketData: {
        subject: string;
        comment: { body: string };
        requester?: { name: string; email: string };
        priority?: "urgent" | "high" | "normal" | "low";
        type?: "problem" | "incident" | "question" | "task";
        tags?: string[];
        assignee_id?: number;
      } = {
        subject: input.subject,
        comment: { body: input.body },
      };

      if (input.priority) ticketData.priority = input.priority;
      if (input.type) ticketData.type = input.type;
      if (input.tags) ticketData.tags = input.tags;
      if (input.assigneeId) ticketData.assignee_id = input.assigneeId;

      if (input.requesterName && input.requesterEmail) {
        ticketData.requester = {
          name: input.requesterName,
          email: input.requesterEmail,
        };
      }

      const ticket = await client.createTicket(ticketData);

      return {
        success: true,
        id: ticket.id,
        url: ticket.url,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        type: ticket.type,
        message: `Ticket #${ticket.id} created successfully`,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to create ticket",
      };
    }
  },
});
