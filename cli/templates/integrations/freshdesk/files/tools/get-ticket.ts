import { tool } from "veryfront/tool";
import { z } from "zod";
import { getTicket, TicketPriority, TicketStatus } from "../../lib/freshdesk-client.ts";

const statusMap: Record<number, string> = {
  [TicketStatus.OPEN]: "open",
  [TicketStatus.PENDING]: "pending",
  [TicketStatus.RESOLVED]: "resolved",
  [TicketStatus.CLOSED]: "closed",
};

const priorityMap: Record<number, string> = {
  [TicketPriority.LOW]: "low",
  [TicketPriority.MEDIUM]: "medium",
  [TicketPriority.HIGH]: "high",
  [TicketPriority.URGENT]: "urgent",
};

export default tool({
  id: "get-ticket",
  description: "Get details of a specific Freshdesk support ticket by its ID.",
  inputSchema: z.object({
    ticketId: z.number().describe("The ID of the ticket to retrieve"),
  }),
  async execute({ ticketId }) {
    const ticket = await getTicket(ticketId);

    return {
      id: ticket.id,
      subject: ticket.subject,
      description: ticket.description,
      descriptionText: ticket.description_text,
      status: statusMap[ticket.status] ?? "unknown",
      priority: priorityMap[ticket.priority] ?? "unknown",
      type: ticket.type,
      requesterId: ticket.requester_id,
      responderId: ticket.responder_id,
      dueBy: ticket.due_by,
      firstResponseDueBy: ticket.fr_due_by,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      tags: ticket.tags,
      customFields: ticket.custom_fields,
    };
  },
});
