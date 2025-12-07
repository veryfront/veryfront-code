import { tool } from "veryfront/ai";
import { z } from "zod";
import { updateTicket, TicketStatus, TicketPriority } from "../../lib/freshdesk-client.ts";

export default tool({
  id: "update-ticket",
  description: "Update an existing Freshdesk support ticket.",
  inputSchema: z.object({
    ticketId: z.number().describe("The ID of the ticket to update"),
    subject: z.string().optional().describe("New subject/title for the ticket"),
    description: z.string().optional().describe("New description or details"),
    status: z
      .enum(["open", "pending", "resolved", "closed"])
      .optional()
      .describe("New status for the ticket"),
    priority: z
      .enum(["low", "medium", "high", "urgent"])
      .optional()
      .describe("New priority level"),
    type: z
      .string()
      .optional()
      .describe("New type of ticket (e.g., 'Question', 'Incident', 'Problem', 'Feature Request')"),
    tags: z.array(z.string()).optional().describe("New tags for the ticket (replaces existing tags)"),
  }),
  async execute({ ticketId, subject, description, status, priority, type, tags }) {
    const priorityMap = {
      low: TicketPriority.LOW,
      medium: TicketPriority.MEDIUM,
      high: TicketPriority.HIGH,
      urgent: TicketPriority.URGENT,
    };

    const statusMap = {
      open: TicketStatus.OPEN,
      pending: TicketStatus.PENDING,
      resolved: TicketStatus.RESOLVED,
      closed: TicketStatus.CLOSED,
    };

    const ticket = await updateTicket(ticketId, {
      subject,
      description,
      status: status ? statusMap[status] : undefined,
      priority: priority ? priorityMap[priority] : undefined,
      type,
      tags,
    });

    return {
      success: true,
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: Object.keys(statusMap).find((key) => statusMap[key as keyof typeof statusMap] === ticket.status) || "unknown",
        priority: Object.keys(priorityMap).find((key) => priorityMap[key as keyof typeof priorityMap] === ticket.priority) || "unknown",
        updatedAt: ticket.updated_at,
      },
    };
  },
});
