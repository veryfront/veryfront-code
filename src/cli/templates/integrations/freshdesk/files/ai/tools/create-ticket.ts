import { tool } from "veryfront/ai";
import { z } from "zod";
import { createTicket, TicketStatus, TicketPriority } from "../../lib/freshdesk-client.ts";

export default tool({
  id: "create-ticket",
  description: "Create a new support ticket in Freshdesk.",
  inputSchema: z.object({
    subject: z.string().describe("The subject/title of the ticket"),
    description: z.string().describe("Description or details of the ticket"),
    email: z.string().email().describe("Email address of the requester"),
    priority: z
      .enum(["low", "medium", "high", "urgent"])
      .default("medium")
      .describe("Priority level of the ticket"),
    status: z
      .enum(["open", "pending"])
      .default("open")
      .describe("Initial status of the ticket"),
    type: z
      .string()
      .optional()
      .describe("Type of ticket (e.g., 'Question', 'Incident', 'Problem', 'Feature Request')"),
    tags: z.array(z.string()).optional().describe("Tags to add to the ticket"),
  }),
  async execute({ subject, description, email, priority, status, type, tags }) {
    const priorityMap = {
      low: TicketPriority.LOW,
      medium: TicketPriority.MEDIUM,
      high: TicketPriority.HIGH,
      urgent: TicketPriority.URGENT,
    };

    const statusMap = {
      open: TicketStatus.OPEN,
      pending: TicketStatus.PENDING,
    };

    const ticket = await createTicket({
      subject,
      description,
      email,
      priority: priorityMap[priority],
      status: statusMap[status],
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
        createdAt: ticket.created_at,
      },
    };
  },
});
