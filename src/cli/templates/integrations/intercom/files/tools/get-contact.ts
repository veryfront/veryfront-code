import { tool } from "veryfront/tool";
import { z } from "zod";
import { getContact } from "../../lib/intercom-client.ts";

function toIsoOrNull(timestamp?: number | null): string | null {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

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
      signedUpAt: toIsoOrNull(contact.signed_up_at),
      lastSeenAt: toIsoOrNull(contact.last_seen_at),
      ownerId: contact.owner_id,
      customAttributes: contact.custom_attributes,
      tags: contact.tags?.map((tag) => ({ id: tag.id, name: tag.name })),
    };
  },
});
