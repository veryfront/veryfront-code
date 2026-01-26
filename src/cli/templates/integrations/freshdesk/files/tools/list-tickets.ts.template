import { tool } from "veryfront/tool";
import { z } from "zod";
import { listTickets, TicketPriority, TicketStatus } from "../../lib/freshdesk-client.ts";

const statusMap = {
  open: TicketStatus.OPEN,
  pending: TicketStatus.PENDING,
  resolved: TicketStatus.RESOLVED,
  closed: TicketStatus.CLOSED,
} as const;

const priorityMap = {
  low: TicketPriority.LOW,
  medium: TicketPriority.MEDIUM,
  high: TicketPriority.HIGH,
  urgent: TicketPriority.URGENT,
} as const;

function getKeyByValue<T extends Record<string, unknown>>(
  map: T,
  value: T[keyof T],
): string {
  return Object.keys(map).find((key) => map[key as keyof T] === value) ?? "unknown";
}

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
      .describe(
        "Filter by ticket type (e.g., 'Question', 'Incident', 'Problem', 'Feature Request')",
      ),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(30)
      .describe("Maximum number of tickets to return"),
  }),
  async execute({ status, priority, type, limit }) {
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
      status: getKeyByValue(statusMap, ticket.status),
      priority: getKeyByValue(priorityMap, ticket.priority),
      type: ticket.type,
      dueBy: ticket.due_by,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      tags: ticket.tags,
    }));
  },
});
