import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatContactName, listContacts } from "../../lib/hubspot-client.ts";

export default tool({
  id: "list-contacts",
  description:
    "List contacts from your HubSpot CRM. Returns contact information including name, email, phone, company, and job title.",
  inputSchema: z.object({
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of contacts to return"),
    properties: z.array(z.string()).optional().describe(
      "Additional properties to retrieve (e.g., website, city, state)",
    ),
  }),
  async execute({ limit, properties }) {
    const response = await listContacts({
      limit,
      properties,
    });

    return {
      contacts: response.results.map((contact) => ({
        id: contact.id,
        name: formatContactName(contact),
        email: contact.properties.email,
        phone: contact.properties.phone,
        company: contact.properties.company,
        jobTitle: contact.properties.jobtitle,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
        additionalProperties: properties
          ? Object.fromEntries(
            properties
              .filter((prop) => contact.properties[prop] !== undefined)
              .map((prop) => [prop, contact.properties[prop]]),
          )
          : undefined,
      })),
      hasMore: !!response.paging?.next,
      nextAfter: response.paging?.next?.after,
    };
  },
});
