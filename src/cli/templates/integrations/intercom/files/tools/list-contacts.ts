import { tool } from "veryfront/tool";
import { z } from "zod";
import { listContacts } from "../../lib/intercom-client.ts";

export default tool({
  id: "list-contacts",
  description:
    "List contacts from Intercom workspace. Returns contact information including email, name, and metadata.",
  inputSchema: z.object({
    page: z.number().min(1).default(1).describe("Page number for pagination"),
    perPage: z
      .number()
      .min(1)
      .max(150)
      .default(50)
      .describe("Number of contacts per page (max 150)"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of contacts to return"),
  }),
  async execute({ page, perPage, limit }) {
    const { contacts, hasMore } = await listContacts({ page, perPage });

    return {
      contacts: contacts.slice(0, limit).map((contact) => {
        const createdAt = new Date(contact.created_at * 1000).toISOString();
        const updatedAt = new Date(contact.updated_at * 1000).toISOString();
        const lastSeenAt = contact.last_seen_at
          ? new Date(contact.last_seen_at * 1000).toISOString()
          : null;

        return {
          id: contact.id,
          email: contact.email,
          name: contact.name,
          phone: contact.phone,
          role: contact.role,
          createdAt,
          updatedAt,
          lastSeenAt,
          ownerId: contact.owner_id,
          tags: contact.tags?.map((tag) => tag.name),
        };
      }),
      hasMore,
      page,
    };
  },
});
