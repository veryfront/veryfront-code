import { tool } from "veryfront/tool";
import { z } from "zod";
import { listTickets, TicketStatus, TicketPriority } from "../../lib/freshdesk-client.ts";

export default tool({
  id: "list-tickets",
  description:
    "List support tickets from Freshdesk. Can filter by status, priority, and type.",
  inputSchema: z.object({
    status: z
      .enum(["open", "pending", "resolved", "closed"])
      .optional()
      .describe("Filter by ticket status"),
    priority: z
      .enum(["low", "medium", "high", "urgent"])
      .optional()
      .describe("Filter by ticket priority"),
    type: z
      .string()
      .optional()
      .describe("Filter by ticket type (e.g., 'Question', 'Incident', 'Problem', 'Feature Request')"),
    limit: z.number().min(1).max(100).default(30).describe("Maximum number of tickets to return"),
  }),
  async execute({ status, priority, type, limit }) {
    const statusMap = {
      open: TicketStatus.OPEN,
      pending: TicketStatus.PENDING,
      resolved: TicketStatus.RESOLVED,
      closed: TicketStatus.CLOSED,
    };

    const priorityMap = {
      low: TicketPriority.LOW,
      medium: TicketPriority.MEDIUM,
      high: TicketPriority.HIGH,
      urgent: TicketPriority.URGENT,
    };

    const tickets = await listTickets({
      status: status ? statusMap[status] : undefined,
      priority: priority ? priorityMap[priority] : undefined,
      type,
      perPage: limit,
    });

    return tickets.map((ticket) => ({
      id: ticket.id,
      subject: ticket.subject,
      description: ticket.description_text,
      status: Object.keys(statusMap).find((key) => statusMap[key as keyof typeof statusMap] === ticket.status) || "unknown",
      priority: Object.keys(priorityMap).find((key) => priorityMap[key as keyof typeof priorityMap] === ticket.priority) || "unknown",
      type: ticket.type,
      dueBy: ticket.due_by,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      tags: ticket.tags,
    }));
  },
});
