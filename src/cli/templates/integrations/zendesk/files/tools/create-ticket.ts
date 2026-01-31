import { z } from "zod";
import { getZendeskClient } from "../../lib/zendesk-client.ts";
import { isZendeskConnected } from "../../lib/token-store.ts";

type TicketData = {
  subject: string;
  comment: { body: string };
  requester?: { name: string; email: string };
  priority?: "urgent" | "high" | "normal" | "low";
  type?: "problem" | "incident" | "question" | "task";
  tags?: string[];
  assignee_id?: number;
};

export default defineTool({
  id: "zendesk-create-ticket",
  description: "Create a new ticket in Zendesk",
  inputSchema: z.object({
    subject: z.string().describe("Subject/title of the ticket"),
    body: z.string().describe("Description/body content of the ticket"),
    priority: z
      .enum(["urgent", "high", "normal", "low"])
      .optional()
      .describe("Priority level of the ticket"),
    type: z
      .enum(["problem", "incident", "question", "task"])
      .optional()
      .describe("Type of ticket"),
    tags: z.array(z.string()).optional().describe("Tags to add to the ticket"),
    assigneeId: z.number().optional().describe("User ID to assign the ticket to"),
    requesterName: z
      .string()
      .optional()
      .describe("Name of the requester (if creating on behalf)"),
    requesterEmail: z
      .string()
      .optional()
      .describe("Email of the requester (if creating on behalf)"),
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

      let requester: TicketData["requester"];
      if (input.requesterName && input.requesterEmail) {
        requester = { name: input.requesterName, email: input.requesterEmail };
      }

      const ticketData: TicketData = {
        subject: input.subject,
        comment: { body: input.body },
        priority: input.priority,
        type: input.type,
        tags: input.tags,
        assignee_id: input.assigneeId,
        requester,
      };

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
