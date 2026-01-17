import { tool } from "veryfront/tool";
import { z } from "zod";
import { listContacts } from "../../lib/freshdesk-client.ts";

export default tool({
  id: "list-contacts",
  description:
    "List customer contacts from Freshdesk. Can filter by email, phone, mobile, or company ID.",
  inputSchema: z.object({
    email: z.string().optional().describe("Filter by contact email address"),
    phone: z.string().optional().describe("Filter by contact phone number"),
    mobile: z.string().optional().describe("Filter by contact mobile number"),
    companyId: z.number().optional().describe("Filter by company ID"),
    limit: z.number().min(1).max(100).default(30).describe("Maximum number of contacts to return"),
  }),
  async execute({ email, phone, mobile, companyId, limit }) {
    const contacts = await listContacts({
      email,
      phone,
      mobile,
      companyId,
      perPage: limit,
    });

    return contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      mobile: contact.mobile,
      companyId: contact.company_id,
      createdAt: contact.created_at,
      updatedAt: contact.updated_at,
      tags: contact.tags,
    }));
  },
});
