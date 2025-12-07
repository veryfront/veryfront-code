import { tool } from "veryfront/ai";
import { z } from "zod";
import { getContact } from "../../lib/intercom-client.ts";

export default tool({
  id: "get-contact",
  description: "Get details of a specific contact from Intercom by their ID.",
  inputSchema: z.object({
    contactId: z.string().describe("The ID of the contact to retrieve"),
  }),
  async execute({ contactId }) {
    const contact = await getContact(contactId);

    return {
      id: contact.id,
      email: contact.email,
      name: contact.name,
      phone: contact.phone,
      role: contact.role,
      externalId: contact.external_id,
      avatar: contact.avatar,
      createdAt: new Date(contact.created_at * 1000).toISOString(),
      updatedAt: new Date(contact.updated_at * 1000).toISOString(),
      signedUpAt: contact.signed_up_at
        ? new Date(contact.signed_up_at * 1000).toISOString()
        : null,
      lastSeenAt: contact.last_seen_at
        ? new Date(contact.last_seen_at * 1000).toISOString()
        : null,
      ownerId: contact.owner_id,
      customAttributes: contact.custom_attributes,
      tags: contact.tags?.map((tag) => ({ id: tag.id, name: tag.name })),
    };
  },
});
